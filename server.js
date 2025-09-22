const express = require("express");
const sql = require("mssql");
const path = require("path");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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

    // Validate PartsOrdered
    const validPartsValues = ["Yes", "No", "Customer Provided"];
    if (!validPartsValues.includes(partsOrdered)) {
      return res.status(400).send("❌ Invalid value for Parts Ordered");
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