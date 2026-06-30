CREATE DATABASE IF NOT EXISTS customer_feedback;
USE customer_feedback;

-- Drop existing view and tables if they exist to apply new schema
DROP VIEW IF EXISTS dashboard_feedback_summary;
DROP TABLE IF EXISTS feedbacks;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS customers;

-- 1. Branches Table (Normalizing branch locations)
CREATE TABLE branches (
    branch_id INT AUTO_INCREMENT PRIMARY KEY,
    branch_name VARCHAR(150) NOT NULL,
    area VARCHAR(100) NOT NULL,
    UNIQUE KEY unique_branch (branch_name, area)
);

-- 2. Customers Table (Normalizing customer profiles)
CREATE TABLE customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    user_name VARCHAR(100) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    UNIQUE KEY unique_customer (user_name, mobile)
);

-- 3. Feedbacks Table (Core transaction & survey ratings)
CREATE TABLE feedbacks (
    unique_id VARCHAR(50) PRIMARY KEY,
    bill_no VARCHAR(50) NOT NULL,
    ref_doc_id VARCHAR(50),
    business_date DATE,
    created_date DATETIME NULL,
    customer_id INT,
    branch_id INT,
    sale_items TEXT,
    ambience VARCHAR(50),
    cleanliness VARCHAR(50),
    availability VARCHAR(50),
    staff VARCHAR(50),
    recommend VARCHAR(50),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL
);

-- 4. Unified Dashboard View (Exposes denormalized data for easy reporting/charts)
CREATE OR REPLACE VIEW dashboard_feedback_summary AS
SELECT 
    f.unique_id,
    f.bill_no,
    f.ref_doc_id,
    f.business_date,
    f.created_date,
    b.area,
    b.branch_name AS branch,
    c.user_name,
    c.mobile,
    f.sale_items,
    f.ambience,
    f.cleanliness,
    f.availability,
    f.staff,
    f.recommend
FROM feedbacks f
LEFT JOIN branches b ON f.branch_id = b.branch_id
LEFT JOIN customers c ON f.customer_id = c.customer_id;
