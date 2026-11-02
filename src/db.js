// Conexión a MySQL y creación automática de tablas.
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
});

const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await q(sql, params))[0] || null;

async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    public_id CHAR(16) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL DEFAULT 'Nueva app',
    slug VARCHAR(60) NULL UNIQUE,
    draft_html MEDIUMTEXT NULL,
    published_html MEDIUMTEXT NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (user_id)
  ) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    role ENUM('user','assistant','note') NOT NULL,
    content TEXT NOT NULL,
    meta TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (project_id)
  ) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    n INT NOT NULL,
    html MEDIUMTEXT NOT NULL,
    note VARCHAR(255) NOT NULL DEFAULT '',
    published TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (project_id)
  ) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    collection VARCHAR(60) NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (project_id, collection)
  ) CHARACTER SET utf8mb4`);
  await q(`CREATE TABLE IF NOT EXISTS uploads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token CHAR(24) NOT NULL UNIQUE,
    mime VARCHAR(60) NOT NULL,
    bytes MEDIUMBLOB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await q(`CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INT NOT NULL,
    day DATE NOT NULL,
    calls INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`);
}

module.exports = { pool, q, one, migrate };
