const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        role VARCHAR(50) NOT NULL CHECK (role IN ('farmer', 'equipment_provider', 'input_supplier', 'transport_provider', 'consumer', 'admin')),
        location VARCHAR(255),
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Equipment table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(100) NOT NULL,
        description TEXT,
        specifications JSONB,
        base_rate_per_day DECIMAL(10,2) NOT NULL,
        location VARCHAR(255),
        availability_status VARCHAR(50) DEFAULT 'available',
        images TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Products table (for inputs like seeds, fertilizers)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT,
        price_per_unit DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        images TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Produce table (for farmer's harvest)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS produce (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT,
        price_per_kg DECIMAL(10,2) NOT NULL,
        stock_kg INTEGER DEFAULT 0,
        harvest_date DATE,
        expiry_date DATE,
        organic BOOLEAN DEFAULT false,
        images TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Equipment bookings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipment_bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        equipment_id UUID REFERENCES equipment(id) ON DELETE CASCADE,
        renter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Orders (for products and produce)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_status VARCHAR(50) DEFAULT 'pending',
        delivery_address TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Order items
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        produce_id UUID REFERENCES produce(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL
      )
    `);

    // Transport requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transport_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
        pickup_location VARCHAR(255) NOT NULL,
        delivery_location VARCHAR(255) NOT NULL,
        cargo_type VARCHAR(100) NOT NULL,
        cargo_weight DECIMAL(10,2),
        estimated_distance DECIMAL(10,2),
        offered_price DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'open',
        pickup_date DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        booking_id UUID REFERENCES equipment_bookings(id) ON DELETE SET NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'INR',
        payment_method VARCHAR(50),
        payment_gateway VARCHAR(50),
        gateway_transaction_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
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

// Store OTPs temporarily (in production, use Redis or database)
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
    const existingUser = await pool.query('SELECT id FROM users WHERE phone = $1 OR email = $2', [phone, email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this phone or email' });
    }

    // Generate OTP
    const otp = generateOTP();
    otpStore.set(phone, { otp, userData: { name, email, phone, role, location }, expiresAt: Date.now() + 300000 }); // 5 minutes

    console.log(`OTP for ${phone}: ${otp}`); // In production, send SMS

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

    // Check if user exists
    const user = await pool.query('SELECT id, name, email, role FROM users WHERE phone = $1', [phone]);
    
    // Generate OTP
    const otp = generateOTP();
    otpStore.set(phone, { otp, expiresAt: Date.now() + 300000 }); // 5 minutes

    console.log(`OTP for ${phone}: ${otp}`); // In production, send SMS

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
      const result = await pool.query(
        'INSERT INTO users (name, email, phone, role, location, is_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, phone, role, location',
        [name, email, phone, role, location, true]
      );
      user = result.rows[0];
    } else {
      // This is login
      const result = await pool.query('SELECT id, name, email, phone, role, location FROM users WHERE phone = $1', [phone]);
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'User not found' });
      }
      user = result.rows[0];
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
        const produceCount = await pool.query('SELECT COUNT(*) FROM produce WHERE farmer_id = $1', [userId]);
        const activeBookings = await pool.query('SELECT COUNT(*) FROM equipment_bookings WHERE renter_id = $1 AND status = $2', [userId, 'active']);
        stats = {
          totalProduce: parseInt(produceCount.rows[0].count),
          activeBookings: parseInt(activeBookings.rows[0].count),
          totalRevenue: 0,
          activeListings: parseInt(produceCount.rows[0].count)
        };
        break;

      case 'equipment_provider':
        const equipmentCount = await pool.query('SELECT COUNT(*) FROM equipment WHERE owner_id = $1', [userId]);
        const bookings = await pool.query('SELECT COUNT(*) FROM equipment_bookings eb JOIN equipment e ON eb.equipment_id = e.id WHERE e.owner_id = $1', [userId]);
        stats = {
          totalEquipment: parseInt(equipmentCount.rows[0].count),
          totalBookings: parseInt(bookings.rows[0].count),
          totalRevenue: 0,
          activeListings: parseInt(equipmentCount.rows[0].count)
        };
        break;

      case 'consumer':
        const orders = await pool.query('SELECT COUNT(*) FROM orders WHERE buyer_id = $1', [userId]);
        stats = {
          totalOrders: parseInt(orders.rows[0].count),
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
      query += ` AND e.type = $${params.length}`;
    }

    if (location) {
      params.push(`%${location}%`);
      query += ` AND e.location ILIKE $${params.length}`;
    }

    query += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    
    res.json({
      equipment: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Equipment list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/equipment', authenticateToken, authorizeRole(['equipment_provider']), async (req, res) => {
  try {
    const { name, type, description, specifications, baseRatePerDay, location, images } = req.body;
    const ownerId = req.user.userId;

    const result = await pool.query(
      'INSERT INTO equipment (owner_id, name, type, description, specifications, base_rate_per_day, location, images) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [ownerId, name, type, description, JSON.stringify(specifications), baseRatePerDay, location, images]
    );

    res.status(201).json(result.rows[0]);
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
      query += ` AND p.category = $${params.length}`;
    }

    if (organic !== undefined) {
      params.push(organic === 'true');
      query += ` AND p.organic = $${params.length}`;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    
    res.json({
      produce: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Produce list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/produce', authenticateToken, authorizeRole(['farmer']), async (req, res) => {
  try {
    const { name, category, description, pricePerKg, stockKg, harvestDate, expiryDate, organic, images } = req.body;
    const farmerId = req.user.userId;

    const result = await pool.query(
      'INSERT INTO produce (farmer_id, name, category, description, price_per_kg, stock_kg, harvest_date, expiry_date, organic, images) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [farmerId, name, category, description, pricePerKg, stockKg, harvestDate, expiryDate, organic, images]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Produce creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ORDERS ROUTES
app.post('/api/v1/orders', authenticateToken, async (req, res) => {
  try {
    const { items, deliveryAddress } = req.body;
    const buyerId = req.user.userId;

    // Start transaction
    const client = await pool.connect();
    await client.query('BEGIN');

    try {
      let totalAmount = 0;
      const sellerId = items[0].sellerId; // Assuming single seller per order

      // Create order
      const orderResult = await client.query(
        'INSERT INTO orders (buyer_id, seller_id, total_amount, delivery_address) VALUES ($1, $2, $3, $4) RETURNING *',
        [buyerId, sellerId, 0, deliveryAddress]
      );
      const orderId = orderResult.rows[0].id;

      // Create order items
      for (const item of items) {
        let unitPrice;
        if (item.type === 'produce') {
          const produce = await client.query('SELECT price_per_kg FROM produce WHERE id = $1', [item.itemId]);
          unitPrice = produce.rows[0].price_per_kg;
        } else if (item.type === 'product') {
          const product = await client.query('SELECT price_per_unit FROM products WHERE id = $1', [item.itemId]);
          unitPrice = product.rows[0].price_per_unit;
        }

        const itemTotal = unitPrice * item.quantity;
        totalAmount += itemTotal;

        await client.query(
          'INSERT INTO order_items (order_id, produce_id, product_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5, $6)',
          [orderId, item.type === 'produce' ? item.itemId : null, item.type === 'product' ? item.itemId : null, item.quantity, unitPrice, itemTotal]
        );
      }

      // Update total amount
      await client.query('UPDATE orders SET total_amount = $1 WHERE id = $2', [totalAmount, orderId]);

      await client.query('COMMIT');
      res.status(201).json({ orderId, totalAmount });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Order creation error:', error);
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
    await pool.query(
      'INSERT INTO payments (user_id, amount, currency, gateway_transaction_id, status) VALUES ($1, $2, $3, $4, $5)',
      [req.user.userId, amount, currency, order.id, 'pending']
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
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count) > 0) {
      console.log('Sample data already exists');
      return;
    }

    // Create sample users
    const users = [
      { name: 'Rajesh Kumar', phone: '9876543210', role: 'farmer', location: 'Punjab' },
      { name: 'Priya Sharma', phone: '9876543211', role: 'equipment_provider', location: 'Haryana' },
      { name: 'Amit Patel', phone: '9876543212', role: 'consumer', location: 'Gujarat' },
      { name: 'Sunita Devi', phone: '9876543213', role: 'input_supplier', location: 'UP' },
      { name: 'Admin User', phone: '9876543214', role: 'admin', location: 'Delhi' }
    ];

    for (const user of users) {
      await pool.query(
        'INSERT INTO users (name, phone, role, location, is_verified) VALUES ($1, $2, $3, $4, $5)',
        [user.name, user.phone, user.role, user.location, true]
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
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();