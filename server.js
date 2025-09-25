
const express = require("express");
const sql = require("mssql");
const path = require("path");
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const session = require('express-session');

const app = express();

// Multer setup for photo uploads
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Photo upload endpoint for car details page
app.post('/upload-photo/:carId', upload.array('photo'), async (req, res) => {
  try {
    const carId = parseInt(req.params.carId);
    if (!carId || !req.files || req.files.length === 0) {
      return res.status(400).send('No files uploaded');
    }
    for (const file of req.files) {
      const photoData = file.buffer.toString('base64');
      await pool.request()
        .input('CarId', sql.Int, carId)
        .input('PhotoData', sql.VarChar(sql.MAX), `data:${file.mimetype};base64,${photoData}`)
        .query('INSERT INTO CarPhotos (CarId, PhotoData, Timestamp) VALUES (@CarId, @PhotoData, GETDATE())');
    }
    res.send('Photo(s) uploaded successfully');
  } catch (err) {
    console.error('❌ Photo upload error:', err);
    res.status(500).send('❌ Error uploading photo(s)');
  }
});

// Increase payload size limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || 'bodyshop_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// SQL Server config
const dbConfig = {
  user: "sa",
  password: "Welcome@100Y!",
  server: "desktop-kgduetp",
  database: "BodyshopDB",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  }
};

// Global connection pool
let pool;
async function initializePool() {
  try {
    pool = await sql.connect(dbConfig);
    pool.on('error', err => {
      console.error('Database pool error:', err);
    });
    console.log("✅ Database connection pool established");
    return pool;
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }
}

// --- Middleware ---
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not logged in' });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }
  next();
}
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/');
}

// Email configuration for FREE Email-to-SMS
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'yousseflteif@gmail.com',
    pass: process.env.EMAIL_PASS || 'uatyeyxstzjmzqwr'
  }
});

// FREE Carrier email-to-SMS gateways
const carrierGateways = {
  'att': '@txt.att.net',
  'verizon': '@vtext.com',
  'tmobile': '@tmomail.net',
  'sprint': '@messaging.sprintpcs.com',
  'metro': '@mymetropcs.com',
  'cricket': '@sms.cricketwireless.net',
  'boost': '@sms.myboostmobile.com',
  'uscellular': '@email.uscc.net'
};

// Initialize database tables if needed
async function initializeDatabase() {
  try {
    // Verify Cars table structure
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='CustomerPhone')
      ALTER TABLE Cars ADD CustomerPhone NVARCHAR(20) NULL
    `);
    
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='SMSNotificationSent')
      ALTER TABLE Cars ADD SMSNotificationSent BIT DEFAULT 0
    `);
    
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='CustomerCarrier')
      ALTER TABLE Cars ADD CustomerCarrier NVARCHAR(50) NULL
    `);
    
    console.log("✅ Database tables verified");
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

// Initialize application
async function initializeApp() {
  await initializePool();
  await initializeDatabase();
}

// --- AUTH ENDPOINTS ---
app.post('/login', express.json(), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Missing credentials');
  try {
    const result = await pool.request()
      .input('Username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE Username = @Username');
    const user = result.recordset[0];
    if (!user) return res.status(401).send('Invalid credentials');
    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) return res.status(401).send('Invalid credentials');
    req.session.user = { username: user.Username, role: user.Role };
    res.send('success');
  } catch (err) {
    res.status(500).send('Login error');
  }
});

app.post('/register', express.json(), async (req, res) => {
  const { username, password, role = 'technician' } = req.body;
  if (!username || !password) return res.status(400).send('Missing credentials');
  try {
    const exists = await pool.request()
      .input('Username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE Username = @Username');
    if (exists.recordset.length > 0) return res.status(409).send('Username already exists');
    const hash = await bcrypt.hash(password, 10);
    await pool.request()
      .input('Username', sql.NVarChar, username)
      .input('PasswordHash', sql.NVarChar, hash)
      .input('Role', sql.NVarChar, role)
      .query('INSERT INTO Users (Username, PasswordHash, Role) VALUES (@Username, @PasswordHash, @Role)');
    res.send('User registered');
  } catch (err) {
    res.status(500).send('Registration error');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.send('Logged out');
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  res.json({ username: req.session.user.username, role: req.session.user.role });
});

// --- ADMIN USER MANAGEMENT ENDPOINTS ---
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.request().query('SELECT Username, Role FROM Users');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send('Error fetching users');
  }
});

app.post('/api/users/role', requireAdmin, express.json(), async (req, res) => {
  const { username, role } = req.body;
  if (!username || !role) return res.status(400).send('Missing data');
  try {
    await pool.request()
      .input('Username', sql.NVarChar, username)
      .input('Role', sql.NVarChar, role)
      .query('UPDATE Users SET Role = @Role WHERE Username = @Username');
    res.send('Role updated');
  } catch (err) {
    res.status(500).send('Error updating role');
  }
});

app.post('/api/users/delete', requireAdmin, express.json(), async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).send('Missing username');
  try {
    await pool.request()
      .input('Username', sql.NVarChar, username)
      .query('DELETE FROM Users WHERE Username = @Username');
    res.send('User deleted');
  } catch (err) {
    res.status(500).send('Error deleting user');
  }
});

// FREE SMS Notification Function using Email-to-SMS
async function sendFreeSMS(carId, customerName, customerPhone, carDetails, carrier = 'tmobile') {
  try {
    if (!customerPhone) {
      console.log(`📱 No phone number for customer ${customerName}, skipping SMS`);
      return false;
    }

    // Clean phone number (remove non-digits and country code)
    const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^1/, '');
    
    if (cleanPhone.length !== 10) {
      console.log(`❌ Invalid phone number format: ${customerPhone}`);
      return false;
    }

    const smsEmail = cleanPhone + carrierGateways[carrier];
    
    // Bilingual message (English + Arabic)
    const message = `
Hello ${customerName}! Your vehicle (${carDetails}) has been completed and is ready for pickup at Master Body Shop. 
You can pick it up during our business hours: Mon-Fri 8AM-6PM, Sat 9AM-2PM.

مرحباً ${customerName}! لقد اكتمل إصلاح مركبتك (${carDetails}) وهي جاهزة للاستلام من ورشة Master Body Shop.
يمكنك استلامها خلال ساعات العمل: الإثنين-الجمعة 8 صباحاً-6 مساءً، السبت 9 صباحاً-2 ظهراً.

Thank you for choosing Master Body Shop!
شكراً لاختياركم ورشتنا!
    `.trim();

    console.log(`📤 Attempting to send FREE SMS to ${smsEmail} via ${carrier}`);

    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@masterbodyshop.com',
      to: smsEmail,
      subject: '', // Empty subject for SMS
      text: message
    };

    await emailTransporter.sendMail(mailOptions);
    console.log(`✅ FREE SMS sent to ${customerName} via ${carrier} gateway`);

    // Mark as sent in database
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('Id', sql.Int, carId)
      .input('Carrier', sql.NVarChar, carrier)
      .query('UPDATE Cars SET SMSNotificationSent = 1, CustomerCarrier = @Carrier WHERE Id = @Id');
    
    return true;

  } catch (error) {
    console.error(`❌ ${carrier} gateway failed:`, error.message);
    
    // Try fallback carriers
    const carriers = Object.keys(carrierGateways);
    for (let fallbackCarrier of carriers) {
      if (fallbackCarrier !== carrier) {
        try {
          const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^1/, '');
          const smsEmail = cleanPhone + carrierGateways[fallbackCarrier];
          
          await emailTransporter.sendMail({
            from: process.env.EMAIL_USER || 'noreply@masterbodyshop.com',
            to: smsEmail,
            text: message
          });
          
          console.log(`✅ SMS sent via fallback carrier: ${fallbackCarrier}`);
          
          // Update carrier in database
          await pool.request()
            .input('Id', sql.Int, carId)
            .input('Carrier', sql.NVarChar, fallbackCarrier)
            .query('UPDATE Cars SET SMSNotificationSent = 1, CustomerCarrier = @Carrier WHERE Id = @Id');
          
          return true;
        } catch (fallbackError) {
          console.log(`❌ ${fallbackCarrier} fallback also failed`);
          continue;
        }
      }
    }
    
    console.error('❌ All FREE SMS methods failed');
    return false;
  }
}

// Enhanced intake route with phone number and carrier support
app.post("/add-car", async (req, res) => {
  const transaction = new sql.Transaction(pool);
  
  try {
    const {
      customer,
      year,
      make,
      model,
      color,
      vin,
      arrivalDate,
      partsOrdered,
      partOrderDate,
      partsArrivalDate,
      readyForWork,
      workStatus,
      bay,
      tech,
      dateDone,
      customerPhone,
      customerCarrier = 'tmobile',
      photos = []
    } = req.body;

    console.log(`📸 Received intake with ${photos.length} photos`);

    // Validate required fields based on actual database structure
    if (!customer || !year || !make || !model || !arrivalDate || !partsOrdered || !readyForWork || !workStatus) {
      return res.status(400).send("❌ Missing required fields");
    }

    // Validate PartsOrdered
    const validPartsValues = ["Yes", "No", "Customer Provided"];
    if (!validPartsValues.includes(partsOrdered)) {
      return res.status(400).send("❌ Invalid value for Parts Ordered");
    }

    // Validate carrier
    if (customerCarrier && !carrierGateways[customerCarrier]) {
      return res.status(400).send("❌ Invalid carrier selection");
    }

    await transaction.begin();

    // Insert car data using actual column names from database
    const carResult = await transaction.request()
      .input("Customer", sql.NVarChar, customer)
      .input("Year", sql.Int, year)
      .input("Make", sql.NVarChar, make)
      .input("Model", sql.NVarChar, model)
      .input("COLOR", sql.NVarChar, color || null) // Note: COLOR in uppercase as per DB
      .input("VIN", sql.NVarChar, vin || null)
      .input("ArrivalDate", sql.Date, arrivalDate)
      .input("PartsOrdered", sql.NVarChar, partsOrdered)
      .input("PartOrderDate", sql.Date, partOrderDate || null)
      .input("PartsArrivalDate", sql.Date, partsArrivalDate || null)
      .input("ReadyForWork", sql.NVarChar, readyForWork)
      .input("WorkStatus", sql.NVarChar, workStatus)
      .input("Bay", sql.NVarChar, bay || null)
      .input("Tech", sql.NVarChar, tech || null)
      .input("DateDone", sql.Date, dateDone || null)
      .input("CustomerPhone", sql.NVarChar, customerPhone || null)
      .input("CustomerCarrier", sql.NVarChar, customerCarrier || null)
      .query(`
        INSERT INTO Cars 
        (Customer, Year, Make, Model, COLOR, VIN, ArrivalDate, PartsOrdered, PartOrderDate, PartsArrivalDate, ReadyForWork, WorkStatus, Bay, Tech, DateDone, CustomerPhone, CustomerCarrier)
        OUTPUT INSERTED.Id
        VALUES 
        (@Customer, @Year, @Make, @Model, @COLOR, @VIN, @ArrivalDate, @PartsOrdered, @PartOrderDate, @PartsArrivalDate, @ReadyForWork, @WorkStatus, @Bay, @Tech, @DateDone, @CustomerPhone, @CustomerCarrier)
      `);

    const carId = carResult.recordset[0].Id;

    // Insert photos if any
    if (photos.length > 0) {
      for (const photo of photos) {
        await transaction.request()
          .input("CarId", sql.Int, carId)
          .input("PhotoData", sql.Text, photo.data)
          .input("Timestamp", sql.NVarChar, photo.timestamp)
          .query(`
            INSERT INTO CarPhotos (CarId, PhotoData, Timestamp)
            VALUES (@CarId, @PhotoData, @Timestamp)
          `);
      }
      console.log(`✅ Inserted ${photos.length} photos for car ID: ${carId}`);
    }

    await transaction.commit();
    res.json({ 
      success: true, 
      message: `✅ Car intake recorded successfully with ${photos.length} photos!`,
      carId: carId
    });

  } catch (err) {
    await transaction.rollback();
    console.error("❌ Database error:", err);
    res.status(500).json({ 
      success: false, 
      message: "❌ Error inserting car data",
      error: err.message 
    });
  }
});

// Update route with FREE SMS notification
app.put("/update-car/:id", async (req, res) => {
  try {
  const { id } = req.params;
  const { workStatus, readyForWork, partsOrdered, notes, customerPayment, customerPhone, customerCarrier, photo } = req.body;

    console.log(`🔄 Updating car ${id} with status: ${workStatus}`);

    // Get current car status before update
    const currentCarResult = await pool.request()
      .input("Id", sql.Int, id)
      .query("SELECT WorkStatus, Customer, CustomerPhone, CustomerCarrier, Year, Make, Model, SMSNotificationSent FROM Cars WHERE Id = @Id");

    if (currentCarResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const currentCar = currentCarResult.recordset[0];
    const previousStatus = currentCar.WorkStatus;

    // Use current value if missing in request
    function fallback(val, current) {
      if (typeof val === 'string') {
        return val.trim() !== '' ? val : current;
      }
      return typeof val !== 'undefined' && val !== null ? val : current;
    }
    const newWorkStatus = typeof workStatus !== 'undefined' && workStatus !== null && workStatus !== '' ? workStatus : currentCar.WorkStatus;
    const newReadyForWork = typeof readyForWork !== 'undefined' && readyForWork !== null && readyForWork !== '' ? readyForWork : currentCar.ReadyForWork;
    const newPartsOrdered = typeof partsOrdered !== 'undefined' && partsOrdered !== null && partsOrdered !== '' ? partsOrdered : currentCar.PartsOrdered;
    const newNotes = typeof notes !== 'undefined' && notes !== null && notes !== '' ? notes : currentCar.Notes ?? null;
    const newCustomerPayment = typeof customerPayment !== 'undefined' && customerPayment !== null ? (customerPayment ? 1 : 0) : (currentCar.CustomerPayment ? 1 : 0);
    const newCustomerPhone = typeof customerPhone !== 'undefined' && customerPhone !== null && customerPhone !== '' ? customerPhone : currentCar.CustomerPhone ?? null;
    const newCustomerCarrier = typeof customerCarrier !== 'undefined' && customerCarrier !== null && customerCarrier !== '' ? customerCarrier : currentCar.CustomerCarrier ?? null;

    await pool.request()
      .input("Id", sql.Int, id)
      .input("WorkStatus", sql.NVarChar, newWorkStatus)
      .input("ReadyForWork", sql.NVarChar, newReadyForWork)
      .input("PartsOrdered", sql.NVarChar, newPartsOrdered)
      .input("Notes", sql.NVarChar, newNotes)
      .input("CustomerPayment", sql.Bit, newCustomerPayment)
      .input("CustomerPhone", sql.NVarChar, newCustomerPhone)
      .input("CustomerCarrier", sql.NVarChar, newCustomerCarrier)
      .query(`
        UPDATE Cars
        SET WorkStatus = @WorkStatus,
            ReadyForWork = @ReadyForWork,
            PartsOrdered = @PartsOrdered,
            Notes = @Notes,
            CustomerPayment = @CustomerPayment,
            CustomerPhone = ISNULL(@CustomerPhone, CustomerPhone),
            CustomerCarrier = ISNULL(@CustomerCarrier, CustomerCarrier)
        WHERE Id = @Id
      `);

    // Send FREE SMS notification if status changed to "Completed"
    if (workStatus === "Completed" && previousStatus !== "Completed") {
      console.log(`🚗 Car ${id} completed! Sending FREE SMS to ${currentCar.Customer}`);
      
      if (currentCar.CustomerPhone && !currentCar.SMSNotificationSent) {
        const carInfo = `${currentCar.Year} ${currentCar.Make} ${currentCar.Model}`;
        const carrier = currentCar.CustomerCarrier || 'tmobile';
        
        // Use setTimeout to avoid blocking the response
        setTimeout(async () => {
          try {
            await sendFreeSMS(id, currentCar.Customer, currentCar.CustomerPhone, carInfo, carrier);
          } catch (smsError) {
            console.error('❌ FREE SMS sending failed in background:', smsError);
          }
        }, 1000);
      } else {
        console.log(`ℹ️ SMS already sent or no phone number for car ${id}`);
      }
    }

    // If a new photo is provided, save it to CarPhotos
    if (photo) {
      try {
        await pool.request()
          .input("CarId", sql.Int, id)
          .input("PhotoData", sql.Text, photo)
          .input("Timestamp", sql.NVarChar, new Date().toISOString())
          .query(`INSERT INTO CarPhotos (CarId, PhotoData, Timestamp) VALUES (@CarId, @PhotoData, @Timestamp)`);
        console.log(`🖼️ Photo added for car ${id}`);
      } catch (photoErr) {
        console.error("❌ Error saving photo:", photoErr);
        // Optionally, you can send a warning in the response
      }
    }
    res.json({ success: true, message: "✅ Car updated successfully!" });

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).json({ 
      success: false, 
      message: "❌ Error updating car",
      error: err.message 
    });
  }
});

// Get car with photos
app.get("/car/:id", async (req, res) => {
  try {
    const carId = req.params.id;

    // Get car details
    const carResult = await pool.request()
      .input("Id", sql.Int, carId)
      .query("SELECT * FROM Cars WHERE Id = @Id");

    if (carResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    // Get photos for this car
    const photosResult = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT Id, Timestamp, CreatedAt FROM CarPhotos WHERE CarId = @CarId ORDER BY CreatedAt DESC");

    const carData = {
      ...carResult.recordset[0],
      photos: photosResult.recordset
    };

    res.json({ success: true, data: carData });

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).json({ 
      success: false, 
      message: "❌ Error fetching car data",
      error: err.message 
    });
  }
});

// Get car photos for car-details.html
app.get("/car/:id/photos", async (req, res) => {
  try {
    const carId = req.params.id;
    const result = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT PhotoData FROM CarPhotos WHERE CarId = @CarId ORDER BY CreatedAt DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching photos" });
  }
});

// --- Car Parts Endpoints for parts-editor.html ---
// Get all parts for a car
app.get("/car/:id/parts", async (req, res) => {
  try {
    const carId = req.params.id;
    const result = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT Id, Name, Status FROM CarParts WHERE CarId = @CarId AND Name IS NOT NULL AND Status IS NOT NULL ORDER BY Id");
    res.json(result.recordset.map(p => ({ id: p.Id, name: p.Name, status: p.Status })));
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching parts" });
  }
});

// Add a part
app.post("/car/:id/parts", express.json(), async (req, res) => {
  try {
    const carId = req.params.id;
    const { partName, status } = req.body;
    if (!partName || !status) return res.status(400).send("Missing partName or status");
    await pool.request()
      .input("CarId", sql.Int, carId)
      .input("Name", sql.NVarChar, partName)
      .input("Status", sql.NVarChar, status)
      .query("INSERT INTO CarParts (CarId, Name, Status) VALUES (@CarId, @Name, @Status)");
    res.send("Part added");
  } catch (err) {
    res.status(500).send("Error adding part");
  }
});

// Update part status
app.put("/car/:id/parts", express.json(), async (req, res) => {
  try {
    const carId = req.params.id;
    const { idx, status } = req.body;
    // idx is the index in the array, but we need the part's Id
    const parts = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT Id FROM CarParts WHERE CarId = @CarId ORDER BY Id");
    const partId = parts.recordset[idx]?.Id;
    if (!partId) return res.status(404).send("Part not found");
    await pool.request()
      .input("Id", sql.Int, partId)
      .input("Status", sql.NVarChar, status)
      .query("UPDATE CarParts SET Status = @Status WHERE Id = @Id");
    res.send("Part updated");
  } catch (err) {
    res.status(500).send("Error updating part");
  }
});

// Delete a part
app.delete("/car/:id/parts", express.json(), async (req, res) => {
  try {
    const carId = req.params.id;
    const { idx } = req.body;
    const parts = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT Id FROM CarParts WHERE CarId = @CarId ORDER BY Id");
    const partId = parts.recordset[idx]?.Id;
    if (!partId) return res.status(404).send("Part not found");
    await pool.request()
      .input("Id", sql.Int, partId)
      .query("DELETE FROM CarParts WHERE Id = @Id");
    res.send("Part deleted");
  } catch (err) {
    res.status(500).send("Error deleting part");
  }
});

// Get photo data by photo ID
app.get("/photo/:id", async (req, res) => {
  try {
    const photoId = req.params.id;

    const result = await pool.request()
      .input("Id", sql.Int, photoId)
      .query("SELECT PhotoData FROM CarPhotos WHERE Id = @Id");

    if (result.recordset.length === 0) {
      return res.status(404).send("Photo not found");
    }

    const base64Data = result.recordset[0].PhotoData;
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    
    if (matches && matches.length === 3) {
      res.set('Content-Type', matches[1]);
      res.send(Buffer.from(matches[2], 'base64'));
    } else {
      res.set('Content-Type', 'image/jpeg');
      res.send(Buffer.from(base64Data, 'base64'));
    }

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error fetching photo");
  }
});

// Get first photo for a car
app.get("/photo/car/:carId", async (req, res) => {
  try {
    const carId = req.params.carId;

    const result = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT TOP 1 PhotoData FROM CarPhotos WHERE CarId = @CarId ORDER BY Id");

    if (result.recordset.length === 0) {
      return res.status(404).send("No photos found");
    }

    const base64Data = result.recordset[0].PhotoData;
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    
    if (matches && matches.length === 3) {
      res.set('Content-Type', matches[1]);
      res.send(Buffer.from(matches[2], 'base64'));
    } else {
      res.set('Content-Type', 'image/jpeg');
      res.send(Buffer.from(base64Data, 'base64'));
    }

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error fetching photo");
  }
});

// Get all cars for dashboard
app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    pool = await sql.connect(dbConfig);
    
    if (req.query.id) {
      const result = await pool.request()
        .input('id', sql.Int, req.query.id)
        .query(`
          SELECT c.*, 
                 (SELECT COUNT(*) FROM CarPhotos WHERE CarId = c.Id) as PhotoCount
          FROM Cars c 
          WHERE c.Id = @id
        `);
      return res.json(result.recordset[0]);
    }

    const result = await pool.request().query(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM CarPhotos WHERE CarId = c.Id) as PhotoCount
      FROM Cars c
      ${whereSQL}
      ORDER BY c.ArrivalDate DESC
    `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).json({ 
      success: false, 
      message: "❌ Error fetching cars",
      error: err.message 
    });
  }
});

// Manual FREE SMS trigger endpoint
app.post("/send-sms/:carId", async (req, res) => {
  try {
    const carId = req.params.carId;

    const carResult = await pool.request()
      .input("Id", sql.Int, carId)
      .query("SELECT Customer, CustomerPhone, CustomerCarrier, Year, Make, Model, SMSNotificationSent FROM Cars WHERE Id = @Id");

    if (carResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const car = carResult.recordset[0];
    
    if (car.SMSNotificationSent) {
      return res.status(400).json({ success: false, message: "SMS already sent for this car" });
    }

    if (!car.CustomerPhone) {
      return res.status(400).json({ success: false, message: "No phone number available for this car" });
    }

    const carInfo = `${car.Year} ${car.Make} ${car.Model}`;
    const carrier = car.CustomerCarrier || 'tmobile';
    
    const success = await sendFreeSMS(carId, car.Customer, car.CustomerPhone, carInfo, carrier);
    
    if (success) {
      res.json({ success: true, message: "✅ FREE SMS notification sent successfully!" });
    } else {
      res.status(500).json({ success: false, message: "❌ Failed to send FREE SMS notification" });
    }

  } catch (err) {
    console.error("❌ Error sending FREE SMS:", err);
    res.status(500).json({ 
      success: false, 
      message: "❌ Error sending FREE SMS notification",
      error: err.message 
    });
  }
});

// Get available carriers
// Photo upload for a specific car
const multer = require('multer');
const upload = multer();

app.post('/upload-photo/:id', upload.single('photo'), async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    const carId = req.params.id;
    if (!req.file) {
      return res.status(400).send('No photo uploaded');
    }
    // Convert buffer to base64 and store with mime type
    const mimeType = req.file.mimetype;
    const base64 = req.file.buffer.toString('base64');
    const photoData = `data:${mimeType};base64,${base64}`;
    const timestamp = new Date().toISOString();
    await pool.request()
      .input('CarId', sql.Int, carId)
      .input('PhotoData', sql.Text, photoData)
      .input('Timestamp', sql.NVarChar, timestamp)
      .query('INSERT INTO CarPhotos (CarId, PhotoData, Timestamp) VALUES (@CarId, @PhotoData, @Timestamp)');
    res.send('Photo uploaded!');
  } catch (err) {
    console.error('❌ Error uploading photo:', err);
    res.status(500).send('❌ Error uploading photo');
  } finally {
    if (pool) await pool.close();
  }
});
app.get("/carriers", (req, res) => {
  res.json({ success: true, data: Object.keys(carrierGateways) });
});

// Error handling middleware

// Serve homepage and HTML files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});
app.get("/dashboard.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});
app.get("/welcome.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "welcome.html"));
});
app.get("/admin-dashboard.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin-dashboard.html"));
});

const PORT = 3030;
app.listen(PORT, () => console.log(`🚗 Server running on http://localhost:${PORT} (FREE SMS Enabled)`));