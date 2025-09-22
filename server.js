const express = require("express");
const sql = require("mssql");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Multer setup for memory storage (so we can convert to Base64)
const upload = multer({ storage: multer.memoryStorage() });

// SQL Server config
const dbConfig = {
  user: "sa",
  password: "Welcome@100Y!",
  server: "DESKTOP-KGDUETP",
  database: "BodyshopDB",
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Intake form POST (with optional car photo)
app.post("/intake", upload.single("carPhoto"), async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const {
      customer, year, make, model, vin, arrivalDate, partsOrdered,
      partOrderDate, partsArrivalDate, readyForWork, workStatus,
      bay, tech, dateDone, color
    } = req.body;

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
      .input("Color", sql.NVarChar, color || null)
      .input("CarPhoto", sql.VarChar(sql.MAX), carPhotoBase64)
      .query(`
        INSERT INTO Cars
        (Customer, Year, Make, Model, VIN, ArrivalDate, PartsOrdered, PartOrderDate, PartsArrivalDate, ReadyForWork, WorkStatus, Bay, Tech, DateDone, Color, CarPhoto)
        VALUES
        (@Customer, @Year, @Make, @Model, @VIN, @ArrivalDate, @PartsOrdered, @PartOrderDate, @PartsArrivalDate, @ReadyForWork, @WorkStatus, @Bay, @Tech, @DateDone, @Color, @CarPhoto)
      `);

    res.send("✅ Car intake recorded successfully!");
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("❌ Error inserting car");
  }
});

// Update a car (status, notes, payment, color, optional photo)
app.put("/update-car/:id", upload.single("carPhoto"), async (req, res) => {
  try {
    const { id } = req.params;
    const { workStatus, readyForWork, partsOrdered, notes, customerPayment, color } = req.body;

    const pool = await sql.connect(dbConfig);

    // Handle uploaded car photo
    let carPhotoBase64 = null;
    if (req.file) {
      carPhotoBase64 = req.file.buffer.toString("base64");
    }

    await pool.request()
      .input("Id", sql.Int, id)
      .input("WorkStatus", sql.NVarChar, workStatus)
      .input("ReadyForWork", sql.NVarChar, readyForWork)
      .input("PartsOrdered", sql.NVarChar, partsOrdered)
      .input("Notes", sql.NVarChar, notes || null)
      .input("CustomerPayment", sql.Bit, customerPayment ? 1 : 0)
      .input("Color", sql.NVarChar, color || null)
      .input("CarPhoto", sql.VarChar(sql.MAX), carPhotoBase64)
      .query(`
        UPDATE Cars
        SET WorkStatus = @WorkStatus,
            ReadyForWork = @ReadyForWork,
            PartsOrdered = @PartsOrdered,
            Notes = @Notes,
            CustomerPayment = @CustomerPayment,
            Color = @Color,
            CarPhoto = COALESCE(@CarPhoto, CarPhoto)
        WHERE Id = @Id
      `);

    res.send("✅ Car updated successfully!");
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).send("❌ Error updating car");
  }
});

// Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Get all cars (dashboard)
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

const PORT = 3030;
app.listen(PORT, () => console.log(`🚗 Server running on http://localhost:${PORT}`));
