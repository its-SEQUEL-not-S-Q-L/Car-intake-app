const express = require("express");
const sql = require("mssql");
const path = require("path");

const app = express();

// Increase payload size limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));

// SQL Server config (adjust if needed)
const dbConfig = {
  user: "sa",              // change if using another login
  password: "Welcome@100Y!", // replace with your SQL Server password
  server: "DESKTOP-KGDUETP",
  database: "BodyshopDB",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};


// Route: intake form POST
app.post("/intake", async (req, res) => {
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
      vin,
      arrivalDate,
      partsOrdered,
      partOrderDate,
      partsArrivalDate,
      readyForWork,
      workStatus,
      bay,
      tech,
      dateDone
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

    // Handle uploaded car photo
    let carPhotoBase64 = null;
    if (req.file) {
      carPhotoBase64 = req.file.buffer.toString("base64");
    }

    await pool.request()
      .input("Customer", sql.NVarChar, customer)
      .input("Year", sql.Int, year)
      .input("Make", sql.NVarChar, make)
      .input("Model", sql.NVarChar, model)
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
      .query(`
        INSERT INTO Cars
        (Customer, Year, Make, Model, VIN, ArrivalDate, PartsOrdered, PartOrderDate, PartsArrivalDate, ReadyForWork, WorkStatus, Bay, Tech, DateDone)
        VALUES
        (@Customer, @Year, @Make, @Model, @VIN, @ArrivalDate, @PartsOrdered, @PartOrderDate, @PartsArrivalDate, @ReadyForWork, @WorkStatus, @Bay, @Tech, @DateDone)
      `);

    res.send("✅ Car intake recorded successfully!");
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("❌ Error inserting car");
  }
});
// Get all cars (dashboard page)
app.get("/dashboard", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query("SELECT * FROM Cars ORDER BY ArrivalDate DESC");
    res.json(result.recordset);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("❌ Error fetching cars");
  }
});

// Update a car (status, notes, payment)
app.put("/update-car/:id", async (req, res) => {
  try {
    pool = await sql.connect(dbConfig);
    const { id } = req.params;
    const { workStatus, readyForWork, partsOrdered, notes, customerPayment } = req.body;

    const pool = await sql.connect(dbConfig);

    await pool.request()
      .input("Id", sql.Int, id)
      .input("WorkStatus", sql.NVarChar, workStatus)
      .input("ReadyForWork", sql.NVarChar, readyForWork)
      .input("PartsOrdered", sql.NVarChar, partsOrdered)
      .input("Notes", sql.NVarChar, notes || null)
      .input("CustomerPayment", sql.Bit, customerPayment ? 1 : 0)
      .query(`
        UPDATE Cars
        SET WorkStatus = @WorkStatus,
            ReadyForWork = @ReadyForWork,
            PartsOrdered = @PartsOrdered,
            Notes = @Notes,
            CustomerPayment = @CustomerPayment
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
// Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
// GET single car by id
app.get('/dashboard', async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    if (req.query.id) {
      const result = await pool.request()
        .input('id', sql.Int, req.query.id)
        .query('SELECT * FROM Cars WHERE Id = @id');
      return res.json(result.recordset[0]);
    }
    const result = await pool.request().query('SELECT * FROM Cars ORDER BY ArrivalDate DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching cars');
  }
});

// PUT update car
app.put('/cars/:id', async (req, res) => {
  try {
    const { WorkStatus, ReadyForWork, Bay, Tech } = req.body;
    const pool = await sql.connect(dbConfig);
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('WorkStatus', sql.VarChar, WorkStatus)
      .input('ReadyForWork', sql.VarChar, ReadyForWork)
      .input('Bay', sql.VarChar, Bay)
      .input('Tech', sql.VarChar, Tech)
      .query(`
        UPDATE Cars
        SET WorkStatus = @WorkStatus,
            ReadyForWork = @ReadyForWork,
            Bay = @Bay,
            Tech = @Tech
        WHERE Id = @id
      `);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating car');
  }
});


const PORT = 3030; // Host on port 3030
app.listen(PORT, () => console.log(`🚗 Server running on http://localhost:${PORT}`));