-- Add CarNotes table for car-specific notes
CREATE TABLE CarNotes (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    CarId INT NOT NULL FOREIGN KEY REFERENCES Cars(Id),
    Username NVARCHAR(50) NOT NULL,
    Note NVARCHAR(MAX) NOT NULL,
    Timestamp DATETIME DEFAULT GETDATE()
);
