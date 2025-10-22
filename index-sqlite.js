const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Database connection
const dbPath = path.join(__dirname, 'agrihub.db');
const db = new sqlite3.Database(dbPath);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database tables
const initDB = async () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          phone TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          role TEXT NOT NULL CHECK (role IN ('farmer', 'equipment_provider', 'input_supplier', 'transport_provider', 'consumer', 'admin')),
          location TEXT,
          is_verified INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Equipment table
      db.run(`
        CREATE TABLE IF NOT EXISTS equipment (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          description TEXT,
          specifications TEXT,
          base_rate_per_day REAL NOT NULL,
          location TEXT,
          availability_status TEXT DEFAULT 'available',
          images TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Produce table
      db.run(`
        CREATE TABLE IF NOT EXISTS produce (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          farmer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          price_per_kg REAL NOT NULL,
          stock_kg INTEGER DEFAULT 0,
          harvest_date DATE,
          expiry_date DATE,
          organic INTEGER DEFAULT 0,
          images TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Equipment bookings
      db.run(`
        CREATE TABLE IF NOT EXISTS equipment_bookings (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          equipment_id TEXT REFERENCES equipment(id) ON DELETE CASCADE,
          renter_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          total_amount REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          payment_status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Orders
      db.run(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          buyer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          seller_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          total_amount REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          payment_status TEXT DEFAULT 'pending',
          delivery_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Payments
      db.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
          booking_id TEXT REFERENCES equipment_bookings(id) ON DELETE SET NULL,
          amount REAL NOT NULL,
          currency TEXT DEFAULT 'INR',
          payment_method TEXT,
          payment_gateway TEXT,
          gateway_transaction_id TEXT,
          status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, () => {
        console.log('Database tables initialized successfully');
        resolve();
      });
    });
  });
};

// Helper function to run database queries with promises
const runQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const allQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Role-based authorization middleware
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Helper function to generate OTP (mock)
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTPs temporarily
const otpStore = new Map();

// ROUTES

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// AUTH ROUTES
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { name, email, phone, role, location } = req.body;

    if (!name || !phone || !role) {
      return res.status(400).json({ error: 'Name, phone, and role are required' });
    }

    // Check if user exists
    const existingUser = await getQuery('SELECT id FROM users WHERE phone = ? OR email = ?', [phone, email]);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this phone or email' });
    }

    // Generate OTP
    const otp = generateOTP();
    otpStore.set(phone, { 
      otp, 
      userData: { name, email, phone, role, location }, 
      expiresAt: Date.now() + 300000 
    });

    console.log(`OTP for ${phone}: ${otp}`);

    res.json({ message: 'OTP sent successfully', phone });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/auth/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Generate OTP
    const otp = generateOTP();
    otpStore.set(phone, { otp, expiresAt: Date.now() + 300000 });

    console.log(`OTP for ${phone}: ${otp}`);

    res.json({ message: 'OTP sent successfully', phone });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/auth/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required' });
    }

    const storedData = otpStore.get(phone);
    if (!storedData || storedData.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'OTP expired or invalid' });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    let user;
    
    // If userData exists, this is registration
    if (storedData.userData) {
      const { name, email, role, location } = storedData.userData;
      const userId = uuidv4();
      await runQuery(
        'INSERT INTO users (id, name, email, phone, role, location, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, name, email, phone, role, location, 1]
      );
      user = await getQuery('SELECT id, name, email, phone, role, location FROM users WHERE id = ?', [userId]);
    } else {
      // This is login
      user = await getQuery('SELECT id, name, email, phone, role, location FROM users WHERE phone = ?', [phone]);
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    // Clear OTP
    otpStore.delete(phone);

    res.json({ 
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        location: user.location
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DASHBOARD ROUTES
app.get('/api/v1/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    let stats = {};

    switch (userRole) {
      case 'farmer':
        const produceCount = await getQuery('SELECT COUNT(*) as count FROM produce WHERE farmer_id = ?', [userId]);
        const activeBookings = await getQuery('SELECT COUNT(*) as count FROM equipment_bookings WHERE renter_id = ? AND status = ?', [userId, 'active']);
        stats = {
          totalProduce: produceCount?.count || 0,
          activeBookings: activeBookings?.count || 0,
          totalRevenue: 0,
          activeListings: produceCount?.count || 0
        };
        break;

      case 'equipment_provider':
        const equipmentCount = await getQuery('SELECT COUNT(*) as count FROM equipment WHERE owner_id = ?', [userId]);
        const bookings = await getQuery('SELECT COUNT(*) as count FROM equipment_bookings eb JOIN equipment e ON eb.equipment_id = e.id WHERE e.owner_id = ?', [userId]);
        stats = {
          totalEquipment: equipmentCount?.count || 0,
          totalBookings: bookings?.count || 0,
          totalRevenue: 0,
          activeListings: equipmentCount?.count || 0
        };
        break;

      case 'consumer':
        const orders = await getQuery('SELECT COUNT(*) as count FROM orders WHERE buyer_id = ?', [userId]);
        stats = {
          totalOrders: orders?.count || 0,
          totalBookings: 0,
          totalRevenue: 0,
          activeListings: 0
        };
        break;

      default:
        stats = {
          totalOrders: 0,
          totalBookings: 0,
          totalRevenue: 0,
          activeListings: 0
        };
    }

    res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// EQUIPMENT ROUTES
app.get('/api/v1/equipment', async (req, res) => {
  try {
    const { page = 1, limit = 10, type, location } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, u.name as owner_name, u.phone as owner_phone, u.location as owner_location
      FROM equipment e
      JOIN users u ON e.owner_id = u.id
      WHERE e.availability_status = 'available'
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND e.type = ?`;
    }

    if (location) {
      params.push(`%${location}%`);
      query += ` AND e.location LIKE ?`;
    }

    query += ` ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const equipment = await allQuery(query, params);
    
    res.json({
      equipment: equipment || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: equipment?.length || 0
      }
    });
  } catch (error) {
    console.error('Equipment list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/equipment', authenticateToken, authorizeRole(['equipment_provider']), async (req, res) => {
  try {
    const { name, type, description, specifications, baseRatePerDay, location } = req.body;
    const ownerId = req.user.userId;
    const equipmentId = uuidv4();

    await runQuery(
      'INSERT INTO equipment (id, owner_id, name, type, description, specifications, base_rate_per_day, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [equipmentId, ownerId, name, type, description, JSON.stringify(specifications), baseRatePerDay, location]
    );

    const equipment = await getQuery('SELECT * FROM equipment WHERE id = ?', [equipmentId]);
    res.status(201).json(equipment);
  } catch (error) {
    console.error('Equipment creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PRODUCE ROUTES
app.get('/api/v1/produce', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, organic } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT p.*, u.name as farmer_name, u.phone as farmer_phone, u.location as farmer_location
      FROM produce p
      JOIN users u ON p.farmer_id = u.id
      WHERE p.stock_kg > 0
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND p.category = ?`;
    }

    if (organic !== undefined) {
      params.push(organic === 'true' ? 1 : 0);
      query += ` AND p.organic = ?`;
    }

    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const produce = await allQuery(query, params);
    
    res.json({
      produce: produce || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: produce?.length || 0
      }
    });
  } catch (error) {
    console.error('Produce list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/produce', authenticateToken, authorizeRole(['farmer']), async (req, res) => {
  try {
    const { name, category, description, pricePerKg, stockKg, harvestDate, expiryDate, organic } = req.body;
    const farmerId = req.user.userId;
    const produceId = uuidv4();

    await runQuery(
      'INSERT INTO produce (id, farmer_id, name, category, description, price_per_kg, stock_kg, harvest_date, expiry_date, organic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [produceId, farmerId, name, category, description, pricePerKg, stockKg, harvestDate, expiryDate, organic ? 1 : 0]
    );

    const produce = await getQuery('SELECT * FROM produce WHERE id = ?', [produceId]);
    res.status(201).json(produce);
  } catch (error) {
    console.error('Produce creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PAYMENTS ROUTES
app.post('/api/v1/payments/create-order', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Mock Razorpay order creation
    const order = {
      id: `order_${Date.now()}`,
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      status: 'created'
    };

    // Store payment record
    const paymentId = uuidv4();
    await runQuery(
      'INSERT INTO payments (id, user_id, amount, currency, gateway_transaction_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [paymentId, req.user.userId, amount, currency, order.id, 'pending']
    );

    res.json(order);
  } catch (error) {
    console.error('Payment order creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Seed some sample data
const seedData = async () => {
  try {
    // Check if data already exists
    const userCount = await getQuery('SELECT COUNT(*) as count FROM users');
    if (userCount && userCount.count > 0) {
      console.log('Sample data already exists');
      return;
    }

    // Create sample users
    const users = [
      { id: uuidv4(), name: 'Rajesh Kumar', phone: '9876543210', role: 'farmer', location: 'Punjab' },
      { id: uuidv4(), name: 'Priya Sharma', phone: '9876543211', role: 'equipment_provider', location: 'Haryana' },
      { id: uuidv4(), name: 'Amit Patel', phone: '9876543212', role: 'consumer', location: 'Gujarat' },
      { id: uuidv4(), name: 'Sunita Devi', phone: '9876543213', role: 'input_supplier', location: 'UP' },
      { id: uuidv4(), name: 'Admin User', phone: '9876543214', role: 'admin', location: 'Delhi' }
    ];

    for (const user of users) {
      await runQuery(
        'INSERT INTO users (id, name, phone, role, location, is_verified) VALUES (?, ?, ?, ?, ?, ?)',
        [user.id, user.name, user.phone, user.role, user.location, 1]
      );
    }

    // Add sample equipment
    const sampleEquipment = [
      {
        id: uuidv4(),
        owner_id: users[1].id, // Priya Sharma (equipment provider)
        name: 'John Deere 5310 Tractor',
        type: 'tractor',
        description: '55 HP 4WD Tractor with excellent fuel efficiency',
        specifications: JSON.stringify({ horsepower: '55 HP', fuelType: 'diesel', brand: 'John Deere' }),
        base_rate_per_day: 1500,
        location: 'Haryana, India',
        availability_status: 'available'
      },
      {
        id: uuidv4(),
        owner_id: users[1].id,
        name: 'Kubota Combine Harvester',
        type: 'harvester',
        description: 'Modern combine harvester for wheat and rice',
        specifications: JSON.stringify({ brand: 'Kubota', capacity: '50 acres/day' }),
        base_rate_per_day: 2500,
        location: 'Haryana, India',
        availability_status: 'available'
      }
    ];

    for (const equipment of sampleEquipment) {
      await runQuery(
        'INSERT INTO equipment (id, owner_id, name, type, description, specifications, base_rate_per_day, location, availability_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [equipment.id, equipment.owner_id, equipment.name, equipment.type, equipment.description, equipment.specifications, equipment.base_rate_per_day, equipment.location, equipment.availability_status]
      );
    }

    // Add sample produce
    const sampleProduce = [
      {
        id: uuidv4(),
        farmer_id: users[0].id, // Rajesh Kumar (farmer)
        name: 'Fresh Organic Tomatoes',
        category: 'vegetables',
        description: 'Fresh, organically grown tomatoes from Punjab farms',
        price_per_kg: 45.50,
        stock_kg: 500,
        harvest_date: '2024-10-15',
        organic: 1
      },
      {
        id: uuidv4(),
        farmer_id: users[0].id,
        name: 'Premium Basmati Rice',
        category: 'grains',
        description: 'High quality basmati rice, aged for perfect aroma',
        price_per_kg: 120.00,
        stock_kg: 1000,
        harvest_date: '2024-09-20',
        organic: 0
      }
    ];

    for (const produce of sampleProduce) {
      await runQuery(
        'INSERT INTO produce (id, farmer_id, name, category, description, price_per_kg, stock_kg, harvest_date, organic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [produce.id, produce.farmer_id, produce.name, produce.category, produce.description, produce.price_per_kg, produce.stock_kg, produce.harvest_date, produce.organic]
      );
    }

    console.log('Sample data seeded successfully');
  } catch (error) {
    console.error('Error seeding data:', error);
  }
};

// Start server
const startServer = async () => {
  try {
    await initDB();
    await seedData();
    
    app.listen(PORT, () => {
      console.log(`🚀 AgriHub API server running on port ${PORT}`);
      console.log(`📚 Health check: http://localhost:${PORT}/health`);
      console.log(`🗄️  Using SQLite database: ${dbPath}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();