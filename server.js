
const express = require("express");
const sql = require("mssql");
const path = require("path");
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Increase payload size limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));

// SQL Server config
const dbConfig = {
  user: "sa",
  password: "Welcome@100Y!",
  server: "desktop-kgduetp",
  database: "BodyshopDB",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Email configuration for FREE Email-to-SMS
const emailTransporter = nodemailer.createTransport({
  service: 'gmail', // You can use 'outlook', 'yahoo', etc.
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

// Initialize database connection and create tables if needed
async function initializeDatabase() {
  try {
    const pool = await sql.connect(dbConfig);
    
    // Create CarPhotos table if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CarPhotos' AND xtype='U')
      CREATE TABLE CarPhotos (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        CarId INT NOT NULL,
        PhotoData TEXT NOT NULL,
        Timestamp NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (CarId) REFERENCES Cars(Id) ON DELETE CASCADE
      )
    `);
    
    // Add CustomerPhone column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='CustomerPhone')
      ALTER TABLE Cars ADD CustomerPhone NVARCHAR(20) NULL
    `);
    
    // Add SMSNotificationSent column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='SMSNotificationSent')
      ALTER TABLE Cars ADD SMSNotificationSent BIT DEFAULT 0
    `);
    
    // Add CustomerCarrier column if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='CustomerCarrier')
      ALTER TABLE Cars ADD CustomerCarrier NVARCHAR(50) NULL
    `);
    
    console.log("✅ Database tables verified/created");
    await pool.close();
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

// Initialize database on startup
initializeDatabase();

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
      .query('UPDATE Cars SET SMSNotificationSent = 1, CustomerCarrier = @Carrier WHERE Id = @Id', 
        [{ name: 'Carrier', type: sql.NVarChar, value: carrier }]);
    await pool.close();
    
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
          const pool = await sql.connect(dbConfig);
          await pool.request()
            .input('Id', sql.Int, carId)
            .input('Carrier', sql.NVarChar, carrier) 
            .query('UPDATE Cars SET SMSNotificationSent = 1, CustomerCarrier = @Carrier WHERE Id = @Id', 
              [{ name: 'Carrier', type: sql.NVarChar, value: fallbackCarrier }]);
          await pool.close();
          
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
app.post("/intake", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
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
      customerCarrier = 'tmobile', // New field
      photos = []
    } = req.body;

    console.log(`📸 Received intake with ${photos.length} photos`);

    // Validate required fields
    if (!customer || !year || !make || !model || !arrivalDate) {
      return res.status(400).send("❌ Missing required fields");
    }

    // Validate PartsOrdered
    const validPartsValues = ["Yes", "No", "Customer Provided"];
    if (!validPartsValues.includes(partsOrdered)) {
      return res.status(400).send("❌ Invalid value for Parts Ordered");
    }

    // Validate carrier
    if (!carrierGateways[customerCarrier]) {
      return res.status(400).send("❌ Invalid carrier selection");
    }

    // Start transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Insert car data
      const carResult = await transaction.request()
        .input("Customer", sql.NVarChar, customer)
        .input("Year", sql.Int, year)
        .input("Make", sql.NVarChar, make)
        .input("Model", sql.NVarChar, model)
        .input("Color", sql.NVarChar, color || null)
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
          (@Customer, @Year, @Make, @Model, @Color, @VIN, @ArrivalDate, @PartsOrdered, @PartOrderDate, @PartsArrivalDate, @ReadyForWork, @WorkStatus, @Bay, @Tech, @DateDone, @CustomerPhone, @CustomerCarrier)
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
      res.send(`✅ Car intake recorded successfully with ${photos.length} photos!`);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error inserting car data");
  } finally {
    if (pool) await pool.close();
  }
});

// Update route with FREE SMS notification
app.put("/update-car/:id", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    const { id } = req.params;
    const { workStatus, readyForWork, partsOrdered, notes, customerPayment, customerPhone, customerCarrier } = req.body;

    console.log(`🔄 Updating car ${id} with status: ${workStatus}`);

    // Get current car status before update
    const currentCarResult = await pool.request()
      .input("Id", sql.Int, id)
      .query("SELECT WorkStatus, Customer, CustomerPhone, CustomerCarrier, Year, Make, Model, SMSNotificationSent FROM Cars WHERE Id = @Id");

    if (currentCarResult.recordset.length === 0) {
      return res.status(404).send("Car not found");
    }

    const currentCar = currentCarResult.recordset[0];
    const previousStatus = currentCar.WorkStatus;

    // Update car data
    await pool.request()
      .input("Id", sql.Int, id)
      .input("WorkStatus", sql.NVarChar, workStatus)
      .input("ReadyForWork", sql.NVarChar, readyForWork)
      .input("PartsOrdered", sql.NVarChar, partsOrdered)
      .input("Notes", sql.NVarChar, notes || null)
      .input("CustomerPayment", sql.Bit, customerPayment ? 1 : 0)
      .input("CustomerPhone", sql.NVarChar, customerPhone || null)
      .input("CustomerCarrier", sql.NVarChar, customerCarrier || null)
      .query(`
        UPDATE Cars
        SET WorkStatus = @WorkStatus,
            ReadyForWork = @ReadyForWork,
            PartsOrdered = @PartsOrdered,
            Notes = @Notes,
            CustomerPayment = @CustomerPayment,
            CustomerPhone = ISNULL(@CustomerPhone, CustomerPhone),
            CustomerCarrier = ISNULL(@CustomerCarrier, CustomerCarrier)
            ${workStatus === "Completed" && previousStatus !== "Completed" ? ", DateDone = GETDATE()" : ""}
        WHERE Id = @Id
      `);

    // Send FREE SMS notification if status changed to "Completed"
    if (workStatus === "Completed" && previousStatus !== "Completed") {
      console.log(`🚗 Car ${id} completed! Sending FREE SMS to ${currentCar.Customer}`);
      
      if (currentCar && !currentCar.SMSNotificationSent) {
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

    res.send("✅ Car updated successfully!");

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error updating car: " + err.message);
  } finally {
    if (pool) await pool.close();
  }
});

// Get car with photos
app.get("/car/:id", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    const carId = req.params.id;

    // Get car details
    const carResult = await pool.request()
      .input("Id", sql.Int, carId)
      .query("SELECT * FROM Cars WHERE Id = @Id");

    if (carResult.recordset.length === 0) {
      return res.status(404).send("Car not found");
    }

    // Get photos for this car
    const photosResult = await pool.request()
      .input("CarId", sql.Int, carId)
      .query("SELECT Id, Timestamp, CreatedAt FROM CarPhotos WHERE CarId = @CarId ORDER BY CreatedAt DESC");

    const carData = {
      ...carResult.recordset[0],
      photos: photosResult.recordset
    };

    res.json(carData);

  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error fetching car data");
  } finally {
    if (pool) await pool.close();
  }
});

// Get photo data by photo ID
app.get("/photo/:id", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
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
  } finally {
    if (pool) await pool.close();
  }
});

// Get first photo for a car
app.get("/photo/car/:carId", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
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
  } finally {
    if (pool) await pool.close();
  }
});

// Get all cars for dashboard
app.get("/dashboard", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    
    // Filtering
    let whereClauses = [];
    let request = pool.request();

    if (req.query.id) {
      request.input('id', sql.Int, req.query.id);
      whereClauses.push('c.Id = @id');
    }
    if (req.query.status) {
      request.input('status', sql.NVarChar, req.query.status);
      whereClauses.push('c.WorkStatus = @status');
    }
    if (req.query.customer) {
      request.input('customer', sql.NVarChar, `%${req.query.customer}%`);
      whereClauses.push('c.Customer LIKE @customer');
    }
    if (req.query.make) {
      request.input('make', sql.NVarChar, `%${req.query.make}%`);
      whereClauses.push('c.Make LIKE @make');
    }
    if (req.query.model) {
      request.input('model', sql.NVarChar, `%${req.query.model}%`);
      whereClauses.push('c.Model LIKE @model');
    }
    if (req.query.vin) {
      request.input('vin', sql.NVarChar, `%${req.query.vin}%`);
      whereClauses.push('c.VIN LIKE @vin');
    }

    // Exclude archived cars (Completed and Paid)
    whereClauses.push("NOT (c.WorkStatus = 'Completed' AND c.CustomerPayment = 1)");
    let whereSQL = whereClauses.length > 0 ? ('WHERE ' + whereClauses.join(' AND ')) : '';
    const result = await request.query(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM CarPhotos WHERE CarId = c.Id) as PhotoCount
      FROM Cars c
      ${whereSQL}
      ORDER BY c.ArrivalDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error fetching cars");
  } finally {
    if (pool) await pool.close();
  }
});

// Manual FREE SMS trigger endpoint
// Archive dashboard: show only completed and paid cars
app.get("/archive-dashboard", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    let whereClauses = ["c.WorkStatus = 'Completed'", "c.CustomerPayment = 1"];
    let request = pool.request();
    if (req.query.customer) {
      request.input('customer', sql.NVarChar, `%${req.query.customer}%`);
      whereClauses.push('c.Customer LIKE @customer');
    }
    if (req.query.make) {
      request.input('make', sql.NVarChar, `%${req.query.make}%`);
      whereClauses.push('c.Make LIKE @make');
    }
    if (req.query.model) {
      request.input('model', sql.NVarChar, `%${req.query.model}%`);
      whereClauses.push('c.Model LIKE @model');
    }
    if (req.query.vin) {
      request.input('vin', sql.NVarChar, `%${req.query.vin}%`);
      whereClauses.push('c.VIN LIKE @vin');
    }
    let whereSQL = 'WHERE ' + whereClauses.join(' AND ');
    const result = await request.query(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM CarPhotos WHERE CarId = c.Id) as PhotoCount
      FROM Cars c
      ${whereSQL}
      ORDER BY c.ArrivalDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error fetching archived cars");
  } finally {
    if (pool) await pool.close();
  }
});
app.post("/send-sms/:carId", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const carId = req.params.carId;

    const carResult = await pool.request()
      .input("Id", sql.Int, carId)
      .query("SELECT Customer, CustomerPhone, CustomerCarrier, Year, Make, Model FROM Cars WHERE Id = @Id");

    if (carResult.recordset.length === 0) {
      return res.status(404).send("Car not found");
    }

    const car = carResult.recordset[0];
    const carInfo = `${car.Year} ${car.Make} ${car.Model}`;
    const carrier = car.CustomerCarrier || 'tmobile';
    
    const success = await sendFreeSMS(carId, car.Customer, car.CustomerPhone, carInfo, carrier);
    
    if (success) {
      res.send("✅ FREE SMS notification sent successfully!");
    } else {
      res.status(500).send("❌ Failed to send FREE SMS notification");
    }

    await pool.close();
  } catch (err) {
    console.error("❌ Error sending FREE SMS:", err);
    res.status(500).send("❌ Error sending FREE SMS notification");
  }
});

// Get available carriers
// Photo upload for a specific car
const multer = require('multer');
const upload = multer();

app.post('/upload-photo/:id', upload.single('photo'), async (req, res) => {
  let pool;
  let attempts = 0;
  const maxAttempts = 3;
  async function tryUpload() {
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
      if (err.code === 'ECONNCLOSED' && attempts < maxAttempts) {
        attempts++;
        console.warn(`DB connection closed, retrying upload (${attempts}/${maxAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempts));
        return tryUpload();
      }
      console.error('❌ Error uploading photo:', err);
      res.status(500).send('❌ Error uploading photo');
    } finally {
      if (pool) await pool.close();
    }
  }
  tryUpload();
});
app.get("/carriers", (req, res) => {
  res.json(Object.keys(carrierGateways));
});

// Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

const PORT = 3030;
app.listen(PORT, () => console.log(`🚗 Server running on http://localhost:${PORT} (FREE SMS Enabled)`));
