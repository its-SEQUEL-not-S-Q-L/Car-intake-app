const express = require("express");
const sql = require("mssql");
const path = require("path");

const app = express();

// Increase payload size limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static("public"));

// SQL Server config
const dbConfig = {
  user: "sa",
  password: "Welcome@100Y!",
  server: "Legion-Y-7000p",
  database: "BodyshopDB",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
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
    
    // Add Color column to Cars table if it doesn't exist
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME='Cars' AND COLUMN_NAME='Color')
      ALTER TABLE Cars ADD Color NVARCHAR(50) NULL
    `);
    
    console.log("✅ Database tables verified/created");
    await pool.close();
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

// Initialize database on startup
initializeDatabase();

// Enhanced intake route with photo support
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
      photos = []  // Array of photo objects
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
        .query(`
          INSERT INTO Cars 
          (Customer, Year, Make, Model, Color, VIN, ArrivalDate, PartsOrdered, PartOrderDate, PartsArrivalDate, ReadyForWork, WorkStatus, Bay, Tech, DateDone)
          OUTPUT INSERTED.Id
          VALUES 
          (@Customer, @Year, @Make, @Model, @Color, @VIN, @ArrivalDate, @PartsOrdered, @PartOrderDate, @PartsArrivalDate, @ReadyForWork, @WorkStatus, @Bay, @Tech, @DateDone)
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

    // Set appropriate content type and send base64 data
    const base64Data = result.recordset[0].PhotoData;
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    
    if (matches && matches.length === 3) {
      res.set('Content-Type', matches[1]);
      res.send(Buffer.from(matches[2], 'base64'));
    } else {
      // If no data URL prefix, assume JPEG
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

// Get all cars for dashboard (without photo data for performance)
app.get("/dashboard", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    
    if (req.query.id) {
      // Single car with photo count
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

    // All cars with photo counts
    const result = await pool.request().query(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM CarPhotos WHERE CarId = c.Id) as PhotoCount
      FROM Cars c 
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
// Update car status, payment, and notes (from dashboard)
app.put("/update-car/:id", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    const { id } = req.params;
    const { workStatus, readyForWork, partsOrdered, notes, customerPayment } = req.body;

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

    res.send("✅ Car updated successfully!");
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error updating car");
  } finally {
    if (pool) await pool.close();
  }
});

// Delete car and associated photos
app.delete("/cars/:id", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(dbConfig);
    
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM Cars WHERE Id = @id');
    
    res.send("✅ Car deleted successfully!");
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).send("❌ Error deleting car");
  } finally {
    if (pool) await pool.close();
  }
});

// Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = 3030;
app.listen(PORT, () => console.log(`🚗 Server running on http://localhost:${PORT}`));