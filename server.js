const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

// Set up MySQL connection pool (with Env Variable fallbacks for Vercel compatibility)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Tgyhuji@4321',
  database: process.env.DB_NAME || 'customer_feedback',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Database migration script to automatically merge spacing duplicates and naming variations
async function runDatabaseMigration() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Running database consistency migration...');
    
    // 1. Merge duplicate branches
    const [branches] = await connection.execute('SELECT branch_id, branch_name, area FROM branches');
    const branchGroups = {};
    
    for (const b of branches) {
      const normName = normalizeBranchName(b.branch_name);
      const normArea = normalizeAreaName(b.area);
      const key = `${normName}|||${normArea}`;
      
      if (!branchGroups[key]) {
        branchGroups[key] = [];
      }
      branchGroups[key].push(b);
    }
    
    for (const key of Object.keys(branchGroups)) {
      const group = branchGroups[key];
      const [normName, normArea] = key.split('|||');
      
      const primaryBranch = group[0];
      
      // Update primary branch to normalized string
      await connection.execute(
        'UPDATE branches SET branch_name = ?, area = ? WHERE branch_id = ?',
        [normName, normArea, primaryBranch.branch_id]
      );
      
      // Merge duplicate branches into primary
      for (let i = 1; i < group.length; i++) {
        const dupBranch = group[i];
        console.log(`Merging branch ${dupBranch.branch_name} (${dupBranch.branch_id}) into ${normName} (${primaryBranch.branch_id})`);
        
        // Update feedbacks referencing duplicate branch
        await connection.execute(
          'UPDATE feedbacks SET branch_id = ? WHERE branch_id = ?',
          [primaryBranch.branch_id, dupBranch.branch_id]
        );
        
        // Delete duplicate branch
        await connection.execute(
          'DELETE FROM branches WHERE branch_id = ?',
          [dupBranch.branch_id]
        );
      }
    }
    
    // 2. Merge duplicate customers
    const [customers] = await connection.execute('SELECT customer_id, user_name, mobile FROM customers');
    const customerGroups = {};
    
    for (const c of customers) {
      const normUser = c.user_name.trim().replace(/\s+/g, ' ');
      const normMobile = c.mobile.trim().replace(/\s+/g, '');
      const key = `${normUser}|||${normMobile}`;
      
      if (!customerGroups[key]) {
        customerGroups[key] = [];
      }
      customerGroups[key].push(c);
    }
    
    for (const key of Object.keys(customerGroups)) {
      const group = customerGroups[key];
      const [normUser, normMobile] = key.split('|||');
      
      const primaryCustomer = group[0];
      await connection.execute(
        'UPDATE customers SET user_name = ?, mobile = ? WHERE customer_id = ?',
        [normUser, normMobile, primaryCustomer.customer_id]
      );
      
      for (let i = 1; i < group.length; i++) {
        const dupCustomer = group[i];
        console.log(`Merging customer ${dupCustomer.user_name} into ${normUser}`);
        
        await connection.execute(
          'UPDATE feedbacks SET customer_id = ? WHERE customer_id = ?',
          [primaryCustomer.customer_id, dupCustomer.customer_id]
        );
        
        await connection.execute(
          'DELETE FROM customers WHERE customer_id = ?',
          [dupCustomer.customer_id]
        );
      }
    }
    
    console.log('Database consistency migration completed successfully.');
  } catch (err) {
    console.error('Database migration failed:', err);
  } finally {
    if (connection) connection.release();
  }
}

// Execute migration
runDatabaseMigration();

// Configure multer for file upload (using memory storage for serverless support)
const upload = multer({ storage: multer.memoryStorage() });

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper function to parse dates formatted as DD-MM-YYYY to YYYY-MM-DD
function parseDate(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();
  
  // DD-MM-YYYY or DD/MM/YYYY
  const dmY = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmY) {
    const day = dmY[1].padStart(2, '0');
    const month = dmY[2].padStart(2, '0');
    const year = dmY[3];
    return `${year}-${month}-${day}`;
  }
  
  // YYYY-MM-DD or YYYY/MM/DD
  const Ymd = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (Ymd) {
    const year = Ymd[1];
    const month = Ymd[2].padStart(2, '0');
    const day = Ymd[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Try normal Date parsing
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }
  
  return null;
}

// Helper function to parse datetime strings or fallback
function parseDateTime(dateTimeStr) {
  if (!dateTimeStr || dateTimeStr.trim() === '' || dateTimeStr.includes('#')) {
    return new Date(); // Fallback to current time if invalid/Excel hash
  }
  
  // DD-MM-YYYY HH:mm:ss or similar
  // Let's check if it starts with date components
  const parts = dateTimeStr.trim().split(/\s+/);
  if (parts.length >= 1) {
    const datePart = parseDate(parts[0]);
    if (datePart) {
      const timePart = parts[1] || '00:00:00';
      return `${datePart} ${timePart}`;
    }
  }
  
  const parsed = Date.parse(dateTimeStr);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  }
  
  return new Date();
}

// Clean and normalize branch names to strip redundant city suffixes
function normalizeBranchName(branchName) {
  if (!branchName) return 'Unknown Branch';
  // Split on comma and take first part (e.g. "JARIPATAKA,NAGPUR" -> "JARIPATAKA")
  let cleanName = branchName.split(',')[0].trim();
  // Replace multiple spaces with a single space
  cleanName = cleanName.replace(/\s+/g, ' ');
  return cleanName;
}

// Normalize area/city names to handle twin cities or spelling variations
function normalizeAreaName(areaName) {
  if (!areaName) return 'Unknown Area';
  let cleanArea = areaName.trim().replace(/\s+/g, ' ');
  const lower = cleanArea.toLowerCase();
  
  if (lower.includes('nagpur')) return 'Nagpur City';
  if (lower.includes('bhilai')) return 'Bhilai';
  if (lower.includes('bilaspur')) return 'Bilaspur';
  if (lower.includes('raipur')) return 'Raipur';
  
  return cleanArea;
}

// Clean and normalize keys from CSV headers (strip spaces, lower case, replace spaces with underscores)
function normalizeRow(row) {
  const normalized = {};
  for (const key of Object.keys(row)) {
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
    normalized[cleanKey] = row[key] ? row[key].trim() : null;
  }
  return normalized;
}

// API endpoint for uploading CSV
app.post('/api/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const results = [];
  
  // Read and parse the CSV from memory buffer
  Readable.from(req.file.buffer)
    .pipe(csv())
    .on('data', (data) => results.push(normalizeRow(data)))
    .on('end', async () => {

      if (results.length === 0) {
        return res.status(400).json({ success: false, message: 'The uploaded CSV file is empty.' });
      }

      // Check if headers match basic expected columns
      const sampleRow = results[0];
      const requiredColumns = ['bill_no', 'user_name', 'mobile'];
      const missing = requiredColumns.filter(col => !(col in sampleRow));
      
      if (missing.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `Missing required CSV column headers: ${missing.join(', ')}. Please verify the file format.`
        });
      }

      let connection;
      let successCount = 0;
      let branchCount = 0;
      let customerCount = 0;
      const errors = [];

      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        for (let i = 0; i < results.length; i++) {
          const row = results[i];
          
          try {
            // 1. Resolve Branch ID (Normalize names and strip redundant city suffixes)
            const branchName = normalizeBranchName(row.branch);
            const areaName = normalizeAreaName(row.area);
            
            const [existingBranches] = await connection.execute(
              'SELECT branch_id FROM branches WHERE branch_name = ? AND area = ?',
              [branchName, areaName]
            );
            
            let branchId;
            if (existingBranches.length > 0) {
              branchId = existingBranches[0].branch_id;
            } else {
              const [branchRes] = await connection.execute(
                'INSERT INTO branches (branch_name, area) VALUES (?, ?)',
                [branchName, areaName]
              );
              branchId = branchRes.insertId;
              branchCount++;
            }

            // 2. Resolve Customer ID (Normalize whitespace and collapse spaces/strip spaces in mobile)
            const userName = (row.user_name || 'Guest Customer').trim().replace(/\s+/g, ' ');
            const mobileNumber = (row.mobile || '0000000000').trim().replace(/\s+/g, '');
            
            const [existingCustomers] = await connection.execute(
              'SELECT customer_id FROM customers WHERE user_name = ? AND mobile = ?',
              [userName, mobileNumber]
            );
            
            let customerId;
            if (existingCustomers.length > 0) {
              customerId = existingCustomers[0].customer_id;
            } else {
              const [customerRes] = await connection.execute(
                'INSERT INTO customers (user_name, mobile) VALUES (?, ?)',
                [userName, mobileNumber]
              );
              customerId = customerRes.insertId;
              customerCount++;
            }

            // 3. Insert or Update Feedback Table
            // Fields maps:
            const uniqueId = row.unique_id || `FEED-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const billNo = row.bill_no;
            const refDocId = row.ref_doc_id || null;
            const businessDate = parseDate(row.business_date);
            const createdDate = parseDateTime(row.created_date);
            const saleItems = row.sale_items || '';
            const ambience = row.ambience || '';
            const cleanliness = row.cleanliness || '';
            const availability = row.availability || '';
            const staff = row.staff || '';
            const recommend = row.recommend || '';

            await connection.execute(
              `INSERT INTO feedbacks (
                unique_id, bill_no, ref_doc_id, business_date, created_date,
                customer_id, branch_id, sale_items,
                ambience, cleanliness, availability, staff, recommend
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                bill_no = VALUES(bill_no),
                ref_doc_id = VALUES(ref_doc_id),
                business_date = VALUES(business_date),
                created_date = VALUES(created_date),
                customer_id = VALUES(customer_id),
                branch_id = VALUES(branch_id),
                sale_items = VALUES(sale_items),
                ambience = VALUES(ambience),
                cleanliness = VALUES(cleanliness),
                availability = VALUES(availability),
                staff = VALUES(staff),
                recommend = VALUES(recommend)`,
              [
                uniqueId, billNo, refDocId, businessDate, createdDate,
                customerId, branchId, saleItems,
                ambience, cleanliness, availability, staff, recommend
              ]
            );

            successCount++;
          } catch (rowErr) {
            console.error(`Error processing row ${i + 1}:`, rowErr);
            errors.push(`Row ${i + 1} (Bill: ${row.bill_no || 'N/A'}): ${rowErr.message}`);
          }
        }

        // Commit transaction
        await connection.commit();
        
        res.json({
          success: true,
          message: `Successfully processed CSV file.`,
          stats: {
            totalRows: results.length,
            successCount,
            newBranches: branchCount,
            newCustomers: customerCount,
            errorCount: errors.length
          },
          errors: errors.slice(0, 10) // Return first 10 errors for debugging
        });

      } catch (dbErr) {
        if (connection) await connection.rollback();
        console.error('Database transaction failed:', dbErr);
        res.status(500).json({ 
          success: false, 
          message: 'A database error occurred during import. Transaction rolled back.',
          error: dbErr.message 
        });
      } finally {
        if (connection) connection.release();
      }
    })
    .on('error', (err) => {
      console.error('CSV Parsing Error:', err);
      res.status(500).json({ success: false, message: 'Failed to parse CSV file.', error: err.message });
    });
});

// API endpoint to retrieve recent data from the dashboard view
app.get('/api/feedbacks', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM dashboard_feedback_summary ORDER BY created_date DESC LIMIT 50');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch data.', error: err.message });
  }
});

// API endpoint to retrieve top & bottom 10 stores based on overall NPS
app.get('/api/analytics/nps/top-bottom', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        b.branch_name AS branch, 
        b.area,
        COUNT(*) as total_responses,
        SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END) as detractors,
        ROUND(((SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) - SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END)) / COUNT(*)) * 100, 1) as nps_score
      FROM feedbacks f
      JOIN branches b ON f.branch_id = b.branch_id
    `;
    
    const params = [];
    if (startDate && endDate) {
      query += ` WHERE f.business_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }
    
    query += `
      GROUP BY b.branch_id
      ORDER BY nps_score DESC
    `;
    
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch top/bottom NPS stats.', error: err.message });
  }
});

// API endpoint to retrieve Month-on-Month NPS trends for stores (unfiltered by date)
app.get('/api/analytics/nps/trends', async (req, res) => {
  try {
    const query = `
      SELECT 
        b.branch_name AS branch,
        b.area,
        DATE_FORMAT(f.business_date, '%Y-%m') as month_key,
        COUNT(*) as total_responses,
        SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END) as detractors,
        ROUND(((SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) - SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END)) / COUNT(*)) * 100, 1) as nps_score
      FROM feedbacks f
      JOIN branches b ON f.branch_id = b.branch_id
      WHERE f.business_date IS NOT NULL
      GROUP BY b.branch_id, month_key
      ORDER BY month_key ASC, nps_score DESC
    `;
    const [rows] = await pool.execute(query);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch NPS trend stats.', error: err.message });
  }
});

// API endpoint to retrieve overall City NPS scores (date filtered)
app.get('/api/analytics/nps/cities', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        b.area AS city,
        COUNT(*) as total_responses,
        SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END) as detractors,
        ROUND(((SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) - SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END)) / COUNT(*)) * 100, 1) as nps_score
      FROM feedbacks f
      JOIN branches b ON f.branch_id = b.branch_id
    `;
    
    const params = [];
    if (startDate && endDate) {
      query += ` WHERE f.business_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }
    
    query += `
      GROUP BY b.area
      ORDER BY nps_score DESC
    `;
    
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch City NPS stats.', error: err.message });
  }
});

// API endpoint to retrieve Month-on-Month NPS trends for cities (unfiltered by date)
app.get('/api/analytics/nps/city-trends', async (req, res) => {
  try {
    const query = `
      SELECT 
        b.area AS city,
        DATE_FORMAT(f.business_date, '%Y-%m') as month_key,
        COUNT(*) as total_responses,
        SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) as promoters,
        SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END) as detractors,
        ROUND(((SUM(CASE WHEN f.recommend IN ('Definitely Yes', 'Probably Yes') THEN 1 ELSE 0 END) - SUM(CASE WHEN f.recommend IN ('Probably not', 'Definitely not') THEN 1 ELSE 0 END)) / COUNT(*)) * 100, 1) as nps_score
      FROM feedbacks f
      JOIN branches b ON f.branch_id = b.branch_id
      WHERE f.business_date IS NOT NULL
      GROUP BY b.area, month_key
      ORDER BY month_key ASC, nps_score DESC
    `;
    const [rows] = await pool.execute(query);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch City NPS trend stats.', error: err.message });
  }
});


// Start Express server locally (Vercel will wrap and export this)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
