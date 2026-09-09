import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./config/db.js";

dotenv.config();

const app = express();

const ensureNotificationTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      booking_id VARCHAR(32) NULL,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX notifications_user_created (user_id, created_at),
      INDEX notifications_booking (user_id, booking_id),
      UNIQUE KEY notifications_booking_type (user_id, booking_id, type)
    )
  `);

  try {
    await db.query("ALTER TABLE notifications ADD COLUMN booking_id VARCHAR(32) NULL AFTER user_id");
  } catch (error) {
    if (!error.message.includes("Duplicate column")) throw error;
  }
};

const createNotification = async ({ userId, bookingId = null, type, title, message, connection = db }) => {
  await connection.query(
    `INSERT INTO notifications (user_id, booking_id, type, title, message)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications
       WHERE user_id = ? AND booking_id <=> ? AND type = ?
     )`,
    [userId, bookingId, type, title, message, userId, bookingId, type]
  );
};

const getIstParts = () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time };
};

const toComparableMinutes = (date, time) => {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  const [hours, minutes] = String(time).slice(0, 5).split(":").map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes) / 60000;
};

const ensureBookingReminders = async (userId) => {
  const [rows] = await db.query(
    `SELECT b.booking_id,
            DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date,
            TIME_FORMAT(b.arrival_time, '%H:%i:%s') AS arrival_time,
            TIME_FORMAT(b.end_time, '%H:%i:%s') AS end_time,
            p.name
     FROM bookings b INNER JOIN parking_locations p ON p.id = b.parking_id
     WHERE b.user_id = ? AND b.status = 'Active'`,
    [userId]
  );

  const now = getIstParts();
  const currentMinutes = toComparableMinutes(now.date, now.time);

  for (const booking of rows) {
    const arrivalMinutes = toComparableMinutes(booking.booking_date, booking.arrival_time);
    const endMinutes = toComparableMinutes(booking.booking_date, booking.end_time);

    if (arrivalMinutes - currentMinutes >= 10 && arrivalMinutes - currentMinutes <= 20) {
      await createNotification({
        userId,
        bookingId: booking.booking_id,
        type: "arrival_reminder",
        title: "Your parking starts soon",
        message: `Are you still coming for your parking booking at ${booking.name}? It starts at ${String(booking.arrival_time).slice(0, 5)}.`,
      });
    }

    if (endMinutes - currentMinutes >= 25 && endMinutes - currentMinutes <= 35) {
      await createNotification({
        userId,
        bookingId: booking.booking_id,
        type: "ending_soon",
        title: "Your parking session is ending soon",
        message: `Your parking booking at ${booking.name} ends at ${String(booking.end_time).slice(0, 5)}.`,
      });
    }
  }
};

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(cors());
app.use(express.json());

// =========================================================
// 30-MINUTE TIME SLOT HELPERS
// =========================================================

  const isValid30MinuteTime = (time) => {
    if (!time) return false;

    const parts = time.split(":").map(Number);

    if (parts.length < 2) return false;

    const hours = parts[0];
    const minutes = parts[1];

    return (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      hours >= 0 &&
      hours <= 23 &&
      (minutes === 0 || minutes === 30)
    );
  };

  const getNext30MinuteSlot = () => {
    const now = new Date();

    // Convert current time to IST
    const istString = now.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    });

    const istNow = new Date(istString);

    let hours = istNow.getHours();
    let minutes = istNow.getMinutes();

    // Round UP to the next 30-minute slot
    if (minutes === 0) {
      minutes = 0;
    } else if (minutes <= 30) {
      minutes = 30;
    } else {
      minutes = 0;
      hours += 1;
    }

    // If rounding pushes us past midnight
    if (hours >= 24) {
      hours = 23;
      minutes = 30;
    }

    return {
      hours,
      minutes,
    };
  };

  const formatTime = (hours, minutes) => {
    return `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:00`;
  };

// =========================================================
// JWT AUTHENTICATION MIDDLEWARE
// =========================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  const token =
    authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Authentication token required",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET,
    (error, user) => {
      if (error) {
        return res.status(403).json({
          message: "Invalid or expired token",
        });
      }

      req.user = user;
      next();
    }
  );
};

app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    await ensureBookingReminders(req.user.userId);
    const [rows] = await db.query(
      `SELECT id, booking_id, type, title, message, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.userId]
    );
    res.json(rows);
  } catch (error) {
    console.error("Fetch notifications error:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

app.put("/api/notifications/:notificationId/read", authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
      [req.params.notificationId, req.user.userId]
    );
    if (result.affectedRows !== 1) return res.status(404).json({ message: "Notification not found" });
    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark notification read error:", error);
    res.status(500).json({ message: "Failed to update notification" });
  }
});

app.put("/api/notifications/read-all", authenticateToken, async (req, res) => {
  try {
    await db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", [req.user.userId]);
    res.json({ message: "Notifications marked as read" });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    res.status(500).json({ message: "Failed to update notifications" });
  }
});

app.post("/api/notifications/:notificationId/confirm-arrival", authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT n.booking_id, p.name, b.arrival_time
       FROM notifications n
       INNER JOIN bookings b ON b.booking_id = n.booking_id AND b.user_id = n.user_id
       INNER JOIN parking_locations p ON p.id = b.parking_id
       WHERE n.id = ? AND n.user_id = ? AND n.type = 'arrival_reminder' AND b.status = 'Active'`,
      [req.params.notificationId, req.user.userId]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Active arrival reminder not found" });

    await db.query("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", [req.params.notificationId, req.user.userId]);
    await createNotification({
      userId: req.user.userId,
      bookingId: rows[0].booking_id,
      type: "arrival_confirmation",
      title: "Parking still reserved",
      message: `Great! Your parking at ${rows[0].name} is still reserved for ${String(rows[0].arrival_time).slice(0, 5)}.`,
    });
    res.json({ message: "Arrival confirmed" });
  } catch (error) {
    console.error("Confirm arrival error:", error);
    res.status(500).json({ message: "Failed to confirm arrival" });
  }
});

// =========================================================
// HOME ROUTE
// =========================================================

app.get("/", (req, res) => {
  res.json({
    message: "SmartKerb backend is running 🚗",
  });
});

// =========================================================
// TEST DATABASE
// =========================================================

app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT 1 AS result"
    );

    res.json({
      message: "MySQL connection successful",
      database: rows,
    });

  } catch (error) {

    console.error(
      "Database test error:",
      error
    );

    res.status(500).json({
      message: "MySQL connection failed",
      error: error.message,
    });
  }
});

// =========================================================
// GET ALL PARKING LOCATIONS
//
// Supports:
//
// /api/parking
//
// /api/parking?date=2026-08-20
//
// /api/parking?date=2026-08-20&arrivalTime=15:30&duration=2
//
// When date + time + duration are supplied,
// availability is calculated specifically for that slot.
// =========================================================

app.get("/api/parking", async (req, res) => {

  try {

    const {
      date,
      arrivalTime,
      duration,
    } = req.query;

    // =======================================================
    // DEFAULT DATE
    // =======================================================

    const selectedDate =
      date ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date());

    // =======================================================
    // GET PARKING LOCATIONS
    // =======================================================

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.address,
        p.total_spots,
        p.available_spots AS base_available_spots,
        p.price_per_hour,
        p.walking_time,
        p.rating,
        p.status AS parking_status,
        p.latitude,
        p.longitude

      FROM parking_locations p

      WHERE LOWER(COALESCE(p.status, 'available')) != 'closed'

      ORDER BY p.id
      `
    );

    // =======================================================
    // NO TIME SLOT SELECTED
    //
    // Return normal daily availability.
    // =======================================================

    if (!arrivalTime || !duration) {

      const result = await Promise.all(

        rows.map(async (parking) => {

          const totalSpots =
            Number(parking.total_spots);

          // Count currently active bookings
          // for this parking location today/selected date
          const [bookingRows] =
            await db.query(
              `
              SELECT COUNT(*) AS occupiedSpots

              FROM bookings

              WHERE parking_id = ?

              AND booking_date = ?

              AND status = 'Active'
              `,
              [
                parking.id,
                selectedDate,
              ]
            );

          const occupiedSpots =
            Number(
              bookingRows[0].occupiedSpots
            );

          const availableSpots =
            Math.max(
              0,
              totalSpots - occupiedSpots
            );

          let status = "Available";

          if (
            parking.parking_status &&
            parking.parking_status.toLowerCase() === "closed"
          ) {

            status = "Closed";

          } else if (availableSpots <= 0) {

            status = "Full";

          } else if (
            availableSpots <= totalSpots * 0.30
          ) {

            status = "Limited";
          }

          return {

            id:
              parking.id,

            name:
              parking.name,

            address:
              parking.address,

            total_spots:
              totalSpots,

            available_spots:
              availableSpots,

            occupied_spots:
              occupiedSpots,

            price_per_hour:
              Number(
                parking.price_per_hour
              ),

            walking_time:
              parking.walking_time,

            rating:
              Number(
                parking.rating
              ),

            status,

            latitude:
              parking.latitude,

            longitude:
              parking.longitude,

            selected_date:
              selectedDate,
          };
        })
      );

      return res.json(result);
    }

    // =======================================================
    // VALIDATE DURATION
    // =======================================================

    const numericDuration =
      Number(duration);

    if (
      !Number.isFinite(numericDuration) ||
      numericDuration <= 0
    ) {

      return res.status(400).json({
        message:
          "Invalid parking duration",
      });
    }

    // =======================================================
    // VALIDATE ARRIVAL TIME
    // =======================================================

    const timeParts =
      arrivalTime
        .split(":")
        .map(Number);

    if (timeParts.length < 2) {

      return res.status(400).json({
        message:
          "Invalid arrival time",
      });
    }

    const startHours =
      timeParts[0];

    const startMinutes =
      timeParts[1];

    if (
      !Number.isFinite(startHours) ||
      !Number.isFinite(startMinutes) ||
      startHours < 0 ||
      startHours > 23 ||
      startMinutes < 0 ||
      startMinutes > 59 ||
      !isValid30MinuteTime(arrivalTime)
    ) {
      return res.status(400).json({
        message:
          "Arrival time must be in 30-minute intervals",
      });
    }

    // =======================================================
    // CALCULATE START TIME
    // =======================================================

    const startTotalMinutes =
      startHours * 60 +
      startMinutes;

    // =======================================================
    // CALCULATE END TIME
    // =======================================================

    const endTotalMinutes =
      startTotalMinutes +
      numericDuration * 60;

    if (
      endTotalMinutes > 24 * 60
    ) {

      return res.status(400).json({
        message:
          "Parking duration cannot extend into the next day",
      });
    }

    const endHours =
      Math.floor(
        endTotalMinutes / 60
      );

    const endMinutes =
      endTotalMinutes % 60;

    const startTime =
      `${String(startHours).padStart(2, "0")}:${String(
        startMinutes
      ).padStart(2, "0")}:00`;

    const endTime =
      `${String(endHours).padStart(2, "0")}:${String(
        endMinutes
      ).padStart(2, "0")}:00`;

    // =======================================================
    // CALCULATE SLOT AVAILABILITY
    // FOR EVERY PARKING LOCATION
    // =======================================================

    const result = await Promise.all(

      rows.map(async (parking) => {

        // ---------------------------------------------------
        // TOTAL PARKING SPOTS
        // ---------------------------------------------------

        const totalSpots =
          Number(parking.total_spots);

        // ---------------------------------------------------
        // COUNT BOOKINGS THAT OVERLAP
        //
        // Existing booking:
        //      10:00 - 12:00
        //
        // Requested:
        //      11:00 - 13:00
        //
        // OVERLAP ✓
        //
        // Existing:
        //      10:00 - 12:00
        //
        // Requested:
        //      12:00 - 14:00
        //
        // NO OVERLAP ✓
        // ---------------------------------------------------

        const [bookingRows] =
          await db.query(
            `
            SELECT COUNT(*) AS occupiedSpots

            FROM bookings

            WHERE parking_id = ?

              AND booking_date = ?

              AND status = 'Active'

              AND arrival_time < ?

              AND end_time > ?
            `,
            [
              parking.id,
              selectedDate,
              endTime,
              startTime,
            ]
          );

        const occupiedSpots =
          Number(
            bookingRows[0]
              .occupiedSpots
          );

        // ---------------------------------------------------
        // SLOT AVAILABILITY
        // ---------------------------------------------------

        const availableSpots =
          Math.max(
            0,
            totalSpots -
              occupiedSpots
          );

        // ---------------------------------------------------
        // STATUS
        // ---------------------------------------------------

        let status = "Available";

        if (
          parking.parking_status &&
          parking.parking_status.toLowerCase() === "closed"
        ) {

          status = "Closed";

        } else if (
          availableSpots <= 0
        ) {

          status = "Full";

        } else if (
          availableSpots <=
          totalSpots * 0.30
        ) {

          status = "Limited";
        }

        // ---------------------------------------------------
        // RETURN PARKING
        // ---------------------------------------------------

        return {

          id:
            parking.id,

          name:
            parking.name,

          address:
            parking.address,

          total_spots:
            totalSpots,

          available_spots:
            availableSpots,

          occupied_spots:
            occupiedSpots,

          price_per_hour:
            Number(
              parking.price_per_hour
            ),

          walking_time:
            parking.walking_time,

          rating:
            Number(
              parking.rating
            ),

          status,

          latitude:
            parking.latitude,

          longitude:
            parking.longitude,

          selected_date:
            selectedDate,

          arrival_time:
            startTime,

          end_time:
            endTime,

          duration:
            numericDuration,
        };
      })
    );

    // =======================================================
    // RETURN SLOT-SPECIFIC AVAILABILITY
    // =======================================================

    return res.json(result);

  } catch (error) {

    console.error(
      "Parking fetch error:",
      error
    );

    return res.status(500).json({
      message:
        "Failed to fetch parking locations",

      error:
        error.message,
    });
  }
});

// =========================================================
// GET PARKING AVAILABILITY FOR SPECIFIC LOCATION
//
// Example:
//
// /api/parking/1/availability
//
// /api/parking/1/availability?date=2026-08-20
//
// /api/parking/1/availability?date=2026-08-20&arrivalTime=15:30&duration=2
// =========================================================

app.get(
  "/api/parking/:parkingId/availability",
  async (req, res) => {

    try {

      const {
        parkingId,
      } = req.params;

      const {
        date,
        arrivalTime,
        duration,
      } = req.query;

      // =====================================================
      // VALIDATE DATE
      // =====================================================

      if (!date) {

        return res.status(400).json({
          message:
            "Date is required",
        });
      }

      // =====================================================
      // GET PARKING
      // =====================================================

      const [parkingRows] =
        await db.query(
          `
          SELECT
            id,
            total_spots,
            available_spots,
            price_per_hour,
            status

          FROM parking_locations

          WHERE id = ?
          `,
          [parkingId]
        );

      if (
        parkingRows.length === 0
      ) {

        return res.status(404).json({
          message:
            "Parking location not found",
        });
      }

      const parking =
        parkingRows[0];

      // =====================================================
      // NO TIME SLOT
      // =====================================================

      if (
        !arrivalTime ||
        !duration
      ) {

        const [availabilityRows] =
          await db.query(
            `
            SELECT
              available_spots

            FROM parking_daily_availability

            WHERE parking_id = ?

            AND availability_date = ?
            `,
            [
              parkingId,
              date,
            ]
          );

        // ===================================================
        // CREATE DAILY AVAILABILITY IF MISSING
        // ===================================================

        if (
          availabilityRows.length === 0
        ) {

          await db.query(
            `
            INSERT INTO
            parking_daily_availability
            (
              parking_id,
              availability_date,
              available_spots
            )

            VALUES (?, ?, ?)
            `,
            [
              parkingId,
              date,
              parking.total_spots,
            ]
          );

          return res.json({

            parkingId:
              Number(parkingId),

            date,

            availableSpots:
              Number(
                parking.total_spots
              ),

            totalSpots:
              Number(
                parking.total_spots
              ),
          });
        }

        return res.json({

          parkingId:
            Number(parkingId),

          date,

          availableSpots:
            Number(
              availabilityRows[0]
                .available_spots
            ),

          totalSpots:
            Number(
              parking.total_spots
            ),
        });
      }

      // =====================================================
      // VALIDATE DURATION
      // =====================================================

      const numericDuration =
        Number(duration);

      if (
        !Number.isFinite(
          numericDuration
        ) ||
        numericDuration <= 0
      ) {

        return res.status(400).json({
          message:
            "Invalid parking duration",
        });
      }

      // =====================================================
      // VALIDATE ARRIVAL TIME
      // =====================================================

      const [
        startHours,
        startMinutes,
      ] =
        arrivalTime
          .split(":")
          .map(Number);

      if (
        !Number.isFinite(startHours) ||
        !Number.isFinite(startMinutes) ||
        startHours < 0 ||
        startHours > 23 ||
        startMinutes < 0 ||
        startMinutes > 59 ||
        !isValid30MinuteTime(arrivalTime)
      ) {
        return res.status(400).json({
          message:
            "Arrival time must be in 30-minute intervals",
        });
      }

      // =====================================================
      // CALCULATE TIMES
      // =====================================================

      const startTotalMinutes =
        startHours * 60 +
        startMinutes;

      const endTotalMinutes =
        startTotalMinutes +
        numericDuration * 60;

      if (
        endTotalMinutes >
        24 * 60
      ) {

        return res.status(400).json({
          message:
            "Parking duration cannot extend into the next day",
        });
      }

      const endHours =
        Math.floor(
          endTotalMinutes / 60
        );

      const endMinutes =
        endTotalMinutes % 60;

      const startTime =
        `${String(startHours).padStart(2, "0")}:${String(
          startMinutes
        ).padStart(2, "0")}:00`;

      const endTime =
        `${String(endHours).padStart(2, "0")}:${String(
          endMinutes
        ).padStart(2, "0")}:00`;

      // =====================================================
      // COUNT OVERLAPPING BOOKINGS
      // =====================================================

      const [bookingRows] =
        await db.query(
          `
          SELECT COUNT(*) AS overlappingBookings

          FROM bookings

          WHERE parking_id = ?

          AND booking_date = ?

          AND status = 'Active'

          AND arrival_time < ?

          AND end_time > ?
          `,
          [
            parkingId,
            date,
            endTime,
            startTime,
          ]
        );

      const occupiedSpots =
        Number(
          bookingRows[0]
            .overlappingBookings
        );

      // =====================================================
      // CALCULATE AVAILABILITY
      // =====================================================

      const totalSpots =
        Number(
          parking.total_spots
        );

      const availableSpots =
        Math.max(
          0,
          totalSpots -
            occupiedSpots
        );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.json({

        parkingId:
          Number(parkingId),

        date,

        arrivalTime:
          startTime,

        endTime,

        duration:
          numericDuration,

        totalSpots,

        occupiedSpots,

        availableSpots,
      });

    } catch (error) {

      console.error(
        "Availability fetch error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch parking availability",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// SIGN UP
// =========================================================

app.post(
  "/api/auth/signup",
  async (req, res) => {

    try {

      const {
        phone,
        password,
      } = req.body;

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !phone ||
        !password
      ) {

        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      if (
        password.length < 6
      ) {

        return res.status(400).json({
          message:
            "Password must contain at least 6 characters",
        });
      }

      // =====================================================
      // CHECK EXISTING USER
      // =====================================================

      const [existingUsers] =
        await db.query(
          `
          SELECT id

          FROM users

          WHERE phone = ?
          `,
          [phone]
        );

      if (
        existingUsers.length > 0
      ) {

        return res.status(409).json({
          message:
            "An account with this phone number already exists",
        });
      }

      // =====================================================
      // HASH PASSWORD
      // =====================================================

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      // =====================================================
      // CREATE USER
      // =====================================================

      await db.query(
        `
        INSERT INTO users
        (
          phone,
          password,
          role
        )

        VALUES (?, ?, 'user')
        `,
        [
          phone,
          hashedPassword,
        ]
      );

      return res.status(201).json({
        message:
          "Account created successfully",
      });

    } catch (error) {

      console.error(
        "Signup error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to create account",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// LOGIN
// =========================================================

app.post(
  "/api/auth/login",
  async (req, res) => {

    try {

      const {
        phone,
        password,
        role,
      } = req.body;

      console.log(
        "Login attempt:",
        phone
      );

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !phone ||
        !password
      ) {

        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      if (role !== "admin" && role !== "user") {
        return res.status(400).json({
          message: "Please select a valid login role.",
        });
      }

      // =====================================================
      // FIND USER
      // =====================================================

      const [users] =
        await db.query(
          `
          SELECT
            id,
            phone,
            password,
            role

          FROM users

          WHERE phone = ?
          `,
          [phone]
        );

      if (
        users.length === 0
      ) {

        return res.status(401).json({
          message:
            "Invalid phone number or password",
        });
      }

      const user =
        users[0];

      // =====================================================
      // CHECK PASSWORD
      // =====================================================

      const passwordMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!passwordMatch) {

        return res.status(401).json({
          message:
            "Invalid phone number or password",
        });
      }

      if (role === "admin" && Number(user.id) !== 1) {
        return res.status(403).json({
          message: "This account does not have administrator access.",
        });
      }

      const effectiveRole = role === "admin" ? "admin" : "user";

      // =====================================================
      // CHECK JWT SECRET
      // =====================================================

      if (
        !process.env.JWT_SECRET
      ) {

        return res.status(500).json({
          message:
            "JWT_SECRET is missing from .env",
        });
      }

      // =====================================================
      // CREATE TOKEN
      // =====================================================

      const token =
        jwt.sign(
          {
            userId:
              user.id,

            phone:
              user.phone,

            role:
              effectiveRole,
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              "1d",
          }
        );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.json({

        message:
          "Login successful",

        token,

        user: {

          id:
            user.id,

          phone:
            user.phone,

          role: 
            effectiveRole,
        },
      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        message:
          "Login failed",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// GET MY ACTIVE BOOKINGS
// =========================================================

app.get(
  "/api/bookings",
  authenticateToken,
  async (req, res) => {

    try {

      console.log(
        "Fetching active bookings for user:",
        req.user.userId
      );

      const [rows] =
        await db.query(
          `
          SELECT

            b.id,

            b.booking_id,

            b.user_id,

            b.parking_id,

            b.booking_date,

            b.arrival_time,

            b.end_time,

            b.duration,

            b.total_price,

            b.status,

            p.name,

            p.address,

            p.available_spots,

            p.total_spots,

            p.price_per_hour,

            p.walking_time,

            p.rating

          FROM bookings b

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          WHERE b.user_id = ?

          AND b.status = 'Active'

          ORDER BY
            b.booking_date DESC,
            b.arrival_time DESC
          `,
          [
            req.user.userId,
          ]
        );

      return res.status(200).json(
        rows
      );

    } catch (error) {

      console.error(
        "Fetch bookings error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch bookings",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// ADMIN AUTHENTICATION MIDDLEWARE
// =========================================================

  const requireAdmin = (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Admin access required",
      });
    }

    next();
  };

  
  // =========================================================
  // ADMIN AUTHENTICATION TEST
  // =========================================================

  app.get(
    "/api/admin/test",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

      return res.json({
        message: "Admin authentication successful",
        admin: {
          id: req.user.userId,
          phone: req.user.phone,
          role: req.user.role,
        },
      });

    }
  );

  // =========================================================
  // ADMIN DASHBOARD SUMMARY
  // =========================================================

  app.get(
    "/api/admin/dashboard",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

      try {

        // =====================================================
        // GET CURRENT IST DATE + TIME
        // =====================================================

        const now = new Date();

        const istDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
        }).format(now);

        const istTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(now);

        // =====================================================
        // PARKING LOCATION SUMMARY
        // =====================================================

        const [parkingRows] = await db.query(
          `
          SELECT
            COUNT(*) AS totalParkingLocations,

            COALESCE(
              SUM(
                CASE
                  WHEN LOWER(status) != 'closed'
                  THEN 1
                  ELSE 0
                END
              ),
              0
            ) AS activeParkingLocations,

            COALESCE(
              SUM(
                CASE
                  WHEN LOWER(status) = 'closed'
                  THEN 1
                  ELSE 0
                END
              ),
              0
            ) AS closedParkingLocations

          FROM parking_locations
          `
        );

        // =====================================================
        // TOTAL CAPACITY
        // =====================================================

        const [spotRows] = await db.query(
          `
          SELECT
            COALESCE(
              SUM(total_spots),
              0
            ) AS totalSpots

          FROM parking_locations

          WHERE LOWER(status) != 'closed'
          `
        );

        // =====================================================
        // ACTIVE BOOKINGS
        // =====================================================

        const [activeBookingRows] = await db.query(
          `
          SELECT
            COUNT(*) AS activeBookings

          FROM bookings

          WHERE status = 'Active'
            AND booking_date = ?
            AND arrival_time <= ?
            AND end_time > ?
          `,
          [istDate, istTime, istTime]
        );

        // =====================================================
        // TODAY'S BOOKINGS
        //
        // IMPORTANT:
        // Use IST date instead of MySQL CURDATE()
        // =====================================================

        const [todayBookingRows] = await db.query(
          `
          SELECT
            COUNT(*) AS todayBookings

          FROM bookings

          WHERE booking_date = ?
          `,
          [istDate]
        );

        // =====================================================
        // TODAY'S REVENUE
        // =====================================================

        const [revenueRows] = await db.query(
          `
          SELECT
            COALESCE(
              SUM(total_price),
              0
            ) AS todayRevenue

          FROM bookings

          WHERE booking_date = ?

          AND status IN (
            'Active',
            'Completed'
          )
          `,
          [istDate]
        );

        // =====================================================
        // CURRENTLY OCCUPIED SPOTS
        //
        // Only count bookings belonging to ACTIVE parking
        // locations.
        // =====================================================

        const [occupiedRows] = await db.query(
          `
          SELECT
            COUNT(*) AS occupiedSpots

          FROM bookings b

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          WHERE b.booking_date = ?

          AND b.status = 'Active'

          AND LOWER(p.status) != 'closed'

          AND b.arrival_time <= ?

          AND b.end_time > ?
          `,
          [
            istDate,
            istTime,
            istTime,
          ]
        );

        // =====================================================
        // CONVERT DATABASE VALUES TO NUMBERS
        // =====================================================

        const totalParkingLocations =
          Number(
            parkingRows[0]?.totalParkingLocations || 0
          );

        const activeParkingLocations =
          Number(
            parkingRows[0]?.activeParkingLocations || 0
          );

        const closedParkingLocations =
          Number(
            parkingRows[0]?.closedParkingLocations || 0
          );

        const totalSpots =
          Number(
            spotRows[0]?.totalSpots || 0
          );

        const occupiedSpots =
          Number(
            occupiedRows[0]?.occupiedSpots || 0
          );

        const availableSpots =
          Math.max(
            0,
            totalSpots - occupiedSpots
          );

        const activeBookings =
          Number(
            activeBookingRows[0]?.activeBookings || 0
          );

        const todayBookings =
          Number(
            todayBookingRows[0]?.todayBookings || 0
          );

        const todayRevenue =
          Number(
            revenueRows[0]?.todayRevenue || 0
          );

        // =====================================================
        // UTILIZATION
        // =====================================================

        const utilization =
          totalSpots > 0
            ? Number(
                (
                  (occupiedSpots / totalSpots) *
                  100
                ).toFixed(1)
              )
            : 0;

        // =====================================================
        // DEBUG LOG
        // =====================================================

        console.log("ADMIN DASHBOARD DATA:", {
          istDate,
          istTime,
          totalParkingLocations,
          activeParkingLocations,
          closedParkingLocations,
          totalSpots,
          occupiedSpots,
          availableSpots,
          activeBookings,
          todayBookings,
          todayRevenue,
          utilization,
        });

        // =====================================================
        // RESPONSE
        // =====================================================

        return res.json({

          totalParkingLocations,

          activeParkingLocations,

          closedParkingLocations,

          totalSpots,

          occupiedSpots,

          availableSpots,

          activeBookings,

          todayBookings,

          todayRevenue,

          utilization,

        });

      } catch (error) {

        console.error(
          "Admin dashboard error:",
          error
        );

        return res.status(500).json({

          message:
            "Failed to fetch admin dashboard data",

          error:
            error.message,

        });

      }
    }
  );
  // =========================================================
  // ADMIN - PARKING LOCATIONS
  // =========================================================

  app.get(
    "/api/admin/parking",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

      try {

        const now = new Date();
        const istDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
        }).format(now);
        const istTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(now);

        const [rows] = await db.query(
          `
          SELECT
            p.id,
            p.name,
            p.address,
            p.total_spots,
            p.price_per_hour,
            p.walking_time,
            p.rating,
            p.status,
            p.latitude,
            p.longitude,

            COUNT(
              CASE
                WHEN b.status = 'Active'
                AND b.booking_date = ?
                AND b.arrival_time <= ?
                AND b.end_time > ?
                THEN 1
              END
            ) AS occupied_spots

          FROM parking_locations p

          LEFT JOIN bookings b
            ON b.parking_id = p.id

          GROUP BY
            p.id,
            p.name,
            p.address,
            p.total_spots,
            p.price_per_hour,
            p.walking_time,
            p.rating,
            p.status,
            p.latitude,
            p.longitude

          ORDER BY p.id
          `,
          [istDate, istTime, istTime]
        );

        const result = rows.map((parking) => {

          const totalSpots =
            Number(parking.total_spots);

          const occupiedSpots =
            Number(parking.occupied_spots);

          const availableSpots =
            Math.max(
              0,
              totalSpots - occupiedSpots
            );

          let status = "Available";

          if (
            parking.status &&
            parking.status.toLowerCase() ===
              "closed"
          ) {

            status = "Closed";

          } else if (
            availableSpots === 0
          ) {

            status = "Full";

          } else if (
            availableSpots <=
            totalSpots * 0.30
          ) {

            status = "Limited";
          }

          return {

            id:
              parking.id,

            name:
              parking.name,

            address:
              parking.address,

            totalSpots,

            occupiedSpots,

            availableSpots,

            pricePerHour:
              Number(
                parking.price_per_hour
              ),

            walkingTime:
              parking.walking_time,

            rating:
              Number(
                parking.rating
              ),

            status,

            locationStatus:
              parking.status &&
              parking.status.toLowerCase() === "closed"
                ? "Closed"
                : "Open",

            latitude:
              parking.latitude,

            longitude:
              parking.longitude,

          };

        });

        return res.json(result);

      } catch (error) {

        console.error(
          "Admin parking error:",
          error
        );

        return res.status(500).json({

          message:
            "Failed to fetch parking management data",

          error:
            error.message,

        });

      }
    }
  );

  // =========================================================
  // ADMIN - CREATE PARKING LOCATION
  // =========================================================

  app.post(
    "/api/admin/parking",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const {
          name,
          address,
          latitude,
          longitude,
          capacity,
          pricePerHour,
          status = "Open",
        } = req.body || {};

        const totalSpots = Number(capacity);
        const price = Number(pricePerHour);
        const normalizedStatus =
          String(status).toLowerCase() === "closed"
            ? "Closed"
            : "Available";

        if (
          !String(name || "").trim() ||
          !String(address || "").trim() ||
          !Number.isInteger(totalSpots) ||
          totalSpots <= 0 ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isFinite(Number(latitude)) ||
          !Number.isFinite(Number(longitude))
        ) {
          return res.status(400).json({
            message:
              "Name, address, valid coordinates, capacity, and price are required",
          });
        }

        const [result] = await db.query(
          `
          INSERT INTO parking_locations
            (name, address, total_spots, available_spots, price_per_hour, status, latitude, longitude)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            name.trim(),
            address.trim(),
            totalSpots,
            totalSpots,
            price,
            normalizedStatus,
            Number(latitude),
            Number(longitude),
          ]
        );

        return res.status(201).json({
          message: "Parking location created",
          id: result.insertId,
        });
      } catch (error) {
        console.error("Admin create parking error:", error);
        return res.status(500).json({
          message: "Failed to create parking location",
        });
      }
    }
  );

  // =========================================================
  // ADMIN - EDIT PARKING LOCATION
  // =========================================================

  app.put(
    "/api/admin/parking/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      let connection;

      try {
        const {
          name,
          address,
          latitude,
          longitude,
          capacity,
          pricePerHour,
          status = "Open",
        } = req.body || {};
        const totalSpots = Number(capacity);
        const price = Number(pricePerHour);
        const parkingId = Number(req.params.id);
        const normalizedStatus =
          String(status).toLowerCase() === "closed"
            ? "Closed"
            : "Available";

        if (
          !Number.isInteger(parkingId) ||
          !String(name || "").trim() ||
          !String(address || "").trim() ||
          !Number.isInteger(totalSpots) ||
          totalSpots <= 0 ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isFinite(Number(latitude)) ||
          !Number.isFinite(Number(longitude))
        ) {
          return res.status(400).json({
            message: "Invalid parking location details",
          });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        const [occupiedRows] = await connection.query(
          `
          SELECT COUNT(*) AS occupiedSpots
          FROM bookings
          WHERE parking_id = ?
            AND status = 'Active'
            AND booking_date = CURDATE()
            AND arrival_time <= CURTIME()
            AND end_time > CURTIME()
          `,
          [parkingId]
        );
        const occupiedSpots = Number(occupiedRows[0]?.occupiedSpots || 0);

        if (totalSpots < occupiedSpots) {
          await connection.rollback();
          return res.status(400).json({
            message: `Capacity cannot be lower than ${occupiedSpots} occupied spaces`,
          });
        }

        const [result] = await connection.query(
          `
          UPDATE parking_locations
          SET name = ?, address = ?, total_spots = ?,
              available_spots = ?, price_per_hour = ?, status = ?,
              latitude = ?, longitude = ?
          WHERE id = ?
          `,
          [
            name.trim(),
            address.trim(),
            totalSpots,
            Math.max(0, totalSpots - occupiedSpots),
            price,
            normalizedStatus,
            Number(latitude),
            Number(longitude),
            parkingId,
          ]
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return res.status(404).json({ message: "Parking location not found" });
        }

        await connection.commit();
        return res.json({ message: "Parking location updated" });
      } catch (error) {
        if (connection) {
          await connection.rollback();
        }
        console.error("Admin update parking error:", error);
        return res.status(500).json({
          message: "Failed to update parking location",
        });
      } finally {
        connection?.release();
      }
    }
  );

  // =========================================================
  // ADMIN - CHANGE PARKING STATUS
  // =========================================================

  app.put(
    "/api/admin/parking/:id/status",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const parkingId = Number(req.params.id);
        const normalizedStatus =
          String(req.body?.status || "").toLowerCase() === "closed"
            ? "Closed"
            : String(req.body?.status || "").toLowerCase() === "open"
              ? "Available"
              : "";

        if (!Number.isInteger(parkingId) || !normalizedStatus) {
          return res.status(400).json({ message: "A valid status is required" });
        }

        const [result] = await db.query(
          "UPDATE parking_locations SET status = ? WHERE id = ?",
          [normalizedStatus, parkingId]
        );

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: "Parking location not found" });
        }

        return res.json({
          message: `Parking location ${normalizedStatus.toLowerCase()}`,
        });
      } catch (error) {
        console.error("Admin parking status error:", error);
        return res.status(500).json({
          message: "Failed to update parking status",
        });
      }
    }
  );

  // =========================================================
  // ADMIN - SMART OPERATIONS
  // =========================================================

  app.get(
    "/api/admin/operations",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const now = new Date();
        const istDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
        }).format(now);
        const istTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(now);

        const [locationRows, activityRows, cancellationRows] = await Promise.all([
          db.query(
            `
            SELECT
              p.id,
              p.name,
              p.status AS location_status,
              p.total_spots,
              COUNT(CASE
                WHEN b.status = 'Active'
                  AND b.booking_date = ?
                  AND b.arrival_time <= ?
                  AND b.end_time > ?
                THEN 1
              END) AS occupied_spots
            FROM parking_locations p
            LEFT JOIN bookings b ON b.parking_id = p.id
            GROUP BY p.id, p.name, p.status, p.total_spots
            ORDER BY p.name
            `,
            [istDate, istTime, istTime]
          ),
          db.query(
            `
            SELECT
              b.booking_id,
              b.booking_date,
              b.arrival_time,
              b.status,
              p.name AS parking_name
            FROM bookings b
            INNER JOIN parking_locations p ON b.parking_id = p.id
            ORDER BY b.booking_date DESC, b.arrival_time DESC
            LIMIT 8
            `
          ),
          db.query(
            `
            SELECT COUNT(*) AS cancellations
            FROM bookings
            WHERE booking_date = ? AND status = 'Cancelled'
            `,
            [istDate]
          ),
        ]);

        const locations = locationRows[0].map((row) => {
          const capacity = Number(row.total_spots || 0);
          const occupied = Number(row.occupied_spots || 0);
          const available = Math.max(0, capacity - occupied);
          const occupancy = capacity > 0 ? (occupied / capacity) * 100 : 0;
          const locationStatus = String(row.location_status || "Open").toLowerCase() === "closed"
            ? "Closed"
            : "Open";

          return {
            id: row.id,
            name: row.name,
            capacity,
            occupied,
            available,
            occupancy: Number(occupancy.toFixed(1)),
            status: locationStatus === "Closed"
              ? "Closed"
              : available === 0
                ? "Full"
                : occupancy >= 90
                  ? "Nearly full"
                  : "Open",
          };
        });
        const alerts = [];
        const nearlyFullCount = locations.filter((location) => location.occupancy >= 90 && location.status !== "Closed").length;
        const closedLocations = locations.filter((location) => location.status === "Closed");

        if (nearlyFullCount > 0) {
          alerts.push({
            type: "warning",
            message: `${nearlyFullCount} parking location${nearlyFullCount === 1 ? " is" : "s are"} above 90% occupancy.`,
          });
        }
        closedLocations.slice(0, 3).forEach((location) => {
          alerts.push({ type: "danger", message: `${location.name} is currently closed.` });
        });
        if (Number(cancellationRows[0][0]?.cancellations || 0) >= 3) {
          alerts.push({
            type: "warning",
            message: `${Number(cancellationRows[0][0].cancellations)} cancellations recorded today.`,
          });
        }

        const activities = activityRows[0].map((row) => ({
          id: row.booking_id,
          type: row.status === "Cancelled" ? "cancelled" : "booking",
          message: row.status === "Cancelled"
            ? `Booking ${row.booking_id} was cancelled.`
            : `Booking ${row.booking_id} recorded for ${row.parking_name}.`,
          date: row.booking_date instanceof Date
            ? row.booking_date.toISOString().slice(0, 10)
            : String(row.booking_date),
          time: String(row.arrival_time || "").slice(0, 5),
        }));

        return res.json({
          updatedAt: now.toISOString(),
          locations,
          alerts,
          activities,
        });
      } catch (error) {
        console.error("Admin operations error:", error);
        return res.status(500).json({ message: "Failed to fetch operations data" });
      }
    }
  );

  // =========================================================
  // ADMIN - ALL BOOKINGS
  // =========================================================

  app.get(
    "/api/admin/bookings",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

      try {

        const {
          search = "",
          status = "",
          parkingId = "",
          date = "",
        } = req.query;

        const conditions = [];
        const parameters = [];

        if (search.trim()) {
          conditions.push(
            "(b.booking_id LIKE ? OR u.phone LIKE ? OR p.name LIKE ?)"
          );
          const searchTerm = `%${search.trim()}%`;
          parameters.push(searchTerm, searchTerm, searchTerm);
        }

        if (["Active", "Completed", "Cancelled"].includes(status)) {
          conditions.push("b.status = ?");
          parameters.push(status);
        }

        if (Number.isInteger(Number(parkingId)) && Number(parkingId) > 0) {
          conditions.push("b.parking_id = ?");
          parameters.push(Number(parkingId));
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          conditions.push("b.booking_date = ?");
          parameters.push(date);
        }

        const whereClause = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

        const [rows] = await db.query(
          `
          SELECT

            b.id,

            b.booking_id,

            b.user_id,

            u.phone AS user_phone,

            b.parking_id,

            p.name AS parking_name,

            b.booking_date,

            b.arrival_time,

            b.end_time,

            b.duration,

            b.total_price,

            b.status

          FROM bookings b

          INNER JOIN users u
            ON b.user_id = u.id

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          ${whereClause}

          ORDER BY
            b.booking_date DESC,
            b.arrival_time DESC

          LIMIT 100
          `,
          parameters
        );

        return res.json(
          rows.map((row) => ({
            ...row,
            booking_date:
              row.booking_date instanceof Date
                ? row.booking_date.toISOString().slice(0, 10)
                : String(row.booking_date).slice(0, 10),
          }))
        );

      } catch (error) {

        console.error(
          "Admin bookings error:",
          error
        );

        return res.status(500).json({

          message:
            "Failed to fetch admin bookings",

          error:
            error.message,

        });

      }
    }
  );

  // =========================================================
  // ADMIN - BOOKING DETAILS
  // =========================================================

  app.get(
    "/api/admin/bookings/:bookingId",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const [rows] = await db.query(
          `
          SELECT
            b.id,
            b.booking_id,
            b.user_id,
            u.phone AS user_phone,
            b.parking_id,
            p.name AS parking_name,
            p.address AS parking_address,
            b.booking_date,
            b.arrival_time,
            b.end_time,
            b.duration,
            b.total_price,
            b.status
          FROM bookings b
          INNER JOIN users u ON b.user_id = u.id
          INNER JOIN parking_locations p ON b.parking_id = p.id
          WHERE b.booking_id = ? OR b.id = ?
          LIMIT 1
          `,
          [req.params.bookingId, req.params.bookingId]
        );

        if (rows.length === 0) {
          return res.status(404).json({ message: "Booking not found" });
        }

        return res.json({
          ...rows[0],
          booking_date:
            rows[0].booking_date instanceof Date
              ? rows[0].booking_date.toISOString().slice(0, 10)
              : String(rows[0].booking_date).slice(0, 10),
        });
      } catch (error) {
        console.error("Admin booking detail error:", error);
        return res.status(500).json({ message: "Failed to fetch booking details" });
      }
    }
  );

  // =========================================================
  // ADMIN - USERS
  // =========================================================

  app.get(
    "/api/admin/users",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const [columns] = await db.query(
          `
          SELECT COLUMN_NAME
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'users'
          `
        );
        const columnNames = new Set(columns.map((column) => column.COLUMN_NAME));
        const registrationColumn = ["created_at", "registered_at", "registration_date"]
          .find((column) => columnNames.has(column));
        const registrationSelect = registrationColumn
          ? `u.${registrationColumn}`
          : "NULL";
        const registrationGroupBy = registrationColumn
          ? `, u.${registrationColumn}`
          : "";
        const search = String(req.query.search || "").trim();
        const searchClause = search ? "WHERE u.phone LIKE ?" : "";
        const parameters = search ? [`%${search}%`] : [];

        const [rows] = await db.query(
          `
          SELECT
            u.id,
            u.phone,
            ${registrationSelect} AS registration_date,
            COUNT(b.id) AS total_bookings,
            SUM(CASE WHEN b.status = 'Active' THEN 1 ELSE 0 END) AS active_bookings,
            SUM(CASE WHEN b.status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_bookings
          FROM users u
          LEFT JOIN bookings b ON b.user_id = u.id
          ${searchClause}
          GROUP BY u.id, u.phone${registrationGroupBy}
          ORDER BY u.id DESC
          LIMIT 200
          `,
          parameters
        );

        return res.json(
          rows.map((row) => ({
            id: row.id,
            name: row.phone,
            phone: row.phone,
            registrationDate: row.registration_date,
            totalBookings: Number(row.total_bookings || 0),
            activeBookings: Number(row.active_bookings || 0),
            cancelledBookings: Number(row.cancelled_bookings || 0),
          }))
        );
      } catch (error) {
        console.error("Admin users error:", error);
        return res.status(500).json({ message: "Failed to fetch admin users" });
      }
    }
  );

  // =========================================================
  // ADMIN - USER DETAILS + BOOKING HISTORY
  // =========================================================

  app.get(
    "/api/admin/users/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const [rows] = await db.query(
          `
          SELECT
            u.id,
            u.phone,
            b.booking_id,
            b.booking_date,
            b.arrival_time,
            b.end_time,
            b.duration,
            b.total_price,
            b.status,
            p.name AS parking_name
          FROM users u
          LEFT JOIN bookings b ON b.user_id = u.id
          LEFT JOIN parking_locations p ON b.parking_id = p.id
          WHERE u.id = ?
          ORDER BY b.booking_date DESC, b.arrival_time DESC
          `,
          [Number(req.params.id)]
        );

        if (rows.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        const user = {
          id: rows[0].id,
          name: rows[0].phone,
          phone: rows[0].phone,
          bookings: rows
            .filter((row) => row.booking_id !== null)
            .map((row) => ({
              bookingId: row.booking_id,
              bookingDate: row.booking_date,
              arrivalTime: row.arrival_time,
              endTime: row.end_time,
              duration: Number(row.duration),
              totalPrice: Number(row.total_price),
              status: row.status,
              parkingName: row.parking_name,
            })),
        };

        return res.json(user);
      } catch (error) {
        console.error("Admin user detail error:", error);
        return res.status(500).json({ message: "Failed to fetch user details" });
      }
    }
  );

  // =========================================================
  // ADMIN - ANALYTICS
  // =========================================================

  app.get(
    "/api/admin/analytics",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
      try {
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
        }).format(new Date());
        const requestedStart = String(req.query.startDate || today);
        const requestedEnd = String(req.query.endDate || today);
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;

        if (
          !datePattern.test(requestedStart) ||
          !datePattern.test(requestedEnd) ||
          requestedStart > requestedEnd
        ) {
          return res.status(400).json({
            message: "A valid startDate and endDate range is required",
          });
        }

        const [trendRows, locationRows, statusRows, peakRows] =
          await Promise.all([
            db.query(
              `
              SELECT
                booking_date AS date,
                COUNT(*) AS bookings,
                COALESCE(SUM(CASE WHEN status != 'Cancelled' THEN total_price ELSE 0 END), 0) AS revenue,
                SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancellations
              FROM bookings
              WHERE booking_date BETWEEN ? AND ?
              GROUP BY booking_date
              ORDER BY booking_date
              `,
              [requestedStart, requestedEnd]
            ),
            db.query(
              `
              SELECT
                p.id,
                p.name,
                p.total_spots AS capacity,
                COUNT(CASE WHEN b.status != 'Cancelled' THEN 1 END) AS bookings,
                COALESCE(SUM(CASE WHEN b.status != 'Cancelled' THEN b.duration ELSE 0 END), 0) AS booked_hours,
                COALESCE(SUM(CASE WHEN b.status != 'Cancelled' THEN b.total_price ELSE 0 END), 0) AS revenue
              FROM parking_locations p
              LEFT JOIN bookings b
                ON b.parking_id = p.id
                AND b.booking_date BETWEEN ? AND ?
              GROUP BY p.id, p.name, p.total_spots
              ORDER BY bookings DESC, p.name
              `,
              [requestedStart, requestedEnd]
            ),
            db.query(
              `
              SELECT status, COUNT(*) AS count
              FROM bookings
              WHERE booking_date BETWEEN ? AND ?
              GROUP BY status
              ORDER BY count DESC
              `,
              [requestedStart, requestedEnd]
            ),
            db.query(
              `
              SELECT HOUR(arrival_time) AS hour, COUNT(*) AS bookings
              FROM bookings
              WHERE booking_date BETWEEN ? AND ?
                AND status != 'Cancelled'
              GROUP BY HOUR(arrival_time)
              ORDER BY bookings DESC, hour
              `,
              [requestedStart, requestedEnd]
            ),
          ]);

        const trends = trendRows[0].map((row) => ({
          date:
            row.date instanceof Date
              ? row.date.toISOString().slice(0, 10)
              : String(row.date),
          bookings: Number(row.bookings || 0),
          revenue: Number(row.revenue || 0),
          cancellations: Number(row.cancellations || 0),
        }));
        const dayCount = Math.max(
          1,
          Math.floor(
            (new Date(`${requestedEnd}T00:00:00Z`) -
              new Date(`${requestedStart}T00:00:00Z`)) /
              86400000
          ) + 1
        );
        const locations = locationRows[0].map((row) => {
          const capacity = Number(row.capacity || 0);
          const bookedHours = Number(row.booked_hours || 0);
          const utilization =
            capacity > 0
              ? Number(((bookedHours / (capacity * dayCount * 24)) * 100).toFixed(1))
              : 0;

          return {
            id: row.id,
            name: row.name,
            capacity,
            bookings: Number(row.bookings || 0),
            bookedHours,
            revenue: Number(row.revenue || 0),
            utilization: Math.min(100, utilization),
          };
        });
        const statuses = statusRows[0].map((row) => ({
          status: row.status,
          count: Number(row.count || 0),
        }));
        const peakHours = peakRows[0].map((row) => ({
          hour: Number(row.hour),
          bookings: Number(row.bookings || 0),
        }));
        const totalBookings = trends.reduce((sum, row) => sum + row.bookings, 0);
        const totalRevenue = trends.reduce((sum, row) => sum + row.revenue, 0);
        const totalCancellations = trends.reduce((sum, row) => sum + row.cancellations, 0);

        return res.json({
          range: { startDate: requestedStart, endDate: requestedEnd, dayCount },
          totals: {
            bookings: totalBookings,
            revenue: totalRevenue,
            cancellations: totalCancellations,
          },
          trends,
          locations,
          statuses,
          peakHours,
        });
      } catch (error) {
        console.error("Admin analytics error:", error);
        return res.status(500).json({ message: "Failed to fetch admin analytics" });
      }
    }
  );

// =========================================================
// GET PARKING HISTORY
// =========================================================

app.get(
  "/api/bookings/history",
  authenticateToken,
  async (req, res) => {

    try {

      console.log(
        "Fetching parking history for user:",
        req.user.userId
      );

      const [rows] =
        await db.query(
          `
          SELECT

            b.id,

            b.booking_id,

            b.user_id,

            b.parking_id,

            b.booking_date,

            b.arrival_time,

            b.end_time,

            b.duration,

            b.total_price,

            b.status,

            p.name,

            p.address,

            p.available_spots,

            p.total_spots,

            p.price_per_hour,

            p.walking_time,

            p.rating

          FROM bookings b

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          WHERE b.user_id = ?

          AND b.status IN (
            'Cancelled',
            'Completed'
          )

          ORDER BY
            b.booking_date DESC,
            b.arrival_time DESC
          `,
          [
            req.user.userId,
          ]
        );

      return res.status(200).json(
        rows
      );

    } catch (error) {

      console.error(
        "Fetch parking history error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch parking history",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// CREATE PARKING BOOKING
// =========================================================

app.post(
  "/api/bookings",
  authenticateToken,
  async (req, res) => {

    let connection;

    try {

      console.log(
        "BOOKING REQUEST RECEIVED"
      );

      console.log(
        "User:",
        req.user
      );

      console.log(
        "Body:",
        req.body
      );

      const {
        parkingId,
        bookingDate,
        arrivalTime,
        duration,
      } = req.body;

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !parkingId ||
        !bookingDate ||
        !arrivalTime ||
        !duration
      ) {

        return res.status(400).json({
          message:
            "All booking details are required",
        });
      }

      // =====================================================
      // VALIDATE DURATION
      // =====================================================

      const numericDuration =
        Number(duration);

      if (
        !Number.isFinite(
          numericDuration
        ) ||
        numericDuration <= 0
      ) {

        return res.status(400).json({
          message:
            "Invalid parking duration",
        });
      }

      // =====================================================
      // VALIDATE ARRIVAL TIME
      // =====================================================

      const [
        startHours,
        startMinutes,
      ] =
        arrivalTime
          .split(":")
          .map(Number);

      if (
        !Number.isFinite(startHours) ||
        !Number.isFinite(startMinutes) ||
        startHours < 0 ||
        startHours > 23 ||
        startMinutes < 0 ||
        startMinutes > 59 ||
        !isValid30MinuteTime(arrivalTime)
      ) {
        return res.status(400).json({
          message:
            "Arrival time must be in 30-minute intervals",
        });
      }

      // =====================================================
      // CALCULATE END TIME
      // =====================================================

      const startTotalMinutes =
        startHours * 60 +
        startMinutes;

      const endTotalMinutes =
        startTotalMinutes +
        numericDuration * 60;

      if (
        endTotalMinutes >
        24 * 60
      ) {

        return res.status(400).json({
          message:
            "Parking duration cannot extend into the next day",
        });
      }

      const endHours =
        Math.floor(
          endTotalMinutes / 60
        );

      const endMinutes =
        endTotalMinutes % 60;

      const normalizedArrivalTime =
        `${String(startHours).padStart(2, "0")}:${String(
          startMinutes
        ).padStart(2, "0")}:00`;

      const endTime =
        `${String(endHours).padStart(2, "0")}:${String(
          endMinutes
        ).padStart(2, "0")}:00`;

      // =====================================================
      // DATABASE CONNECTION
      // =====================================================

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      // =====================================================
      // CHECK PARKING LOCATION
      // =====================================================

      const [parkingRows] =
        await connection.query(
          `
          SELECT
            id,
            total_spots,
            price_per_hour,
            status

          FROM parking_locations

          WHERE id = ?

          FOR UPDATE
          `,
          [
            parkingId,
          ]
        );

      if (
        parkingRows.length === 0
      ) {

        await connection.rollback();

        return res.status(404).json({
          message:
            "Parking location not found",
        });
      }

      const parking =
        parkingRows[0];

      // =====================================================
      // CHECK PARKING STATUS
      // =====================================================

      if (
        parking.status &&
        parking.status.toLowerCase() ===
          "closed"
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "This parking location is currently unavailable",
        });
      }

      // =====================================================
      // CHECK OVERLAPPING BOOKINGS
      // =====================================================

      const [
        overlappingBookings,
      ] =
        await connection.query(
          `
          SELECT
            id,
            booking_id

          FROM bookings

          WHERE parking_id = ?

          AND booking_date = ?

          AND status = 'Active'

          AND arrival_time < ?

          AND end_time > ?

          FOR UPDATE
          `,
          [
            parkingId,
            bookingDate,
            endTime,
            normalizedArrivalTime,
          ]
        );

      // =====================================================
      // IMPORTANT:
      // Each booking consumes ONE parking spot.
      // =====================================================

      if (
        overlappingBookings.length >=
        Number(parking.total_spots)
      ) {

        await connection.rollback();

        return res.status(409).json({
          message:
            "No parking spots are available during the selected time slot.",
        });
      }

      // =====================================================
      // CALCULATE PRICE
      // =====================================================

      const pricePerHour =
        Number(
          parking.price_per_hour
        );

      if (
        !Number.isFinite(
          pricePerHour
        ) ||
        pricePerHour < 0
      ) {

        await connection.rollback();

        return res.status(500).json({
          message:
            "Invalid parking price configuration",
        });
      }

      const calculatedTotalPrice =
        Number(
          (
            pricePerHour *
            numericDuration
          ).toFixed(2)
        );

      // =====================================================
      // GENERATE BOOKING ID
      // =====================================================

      let bookingId;

      let bookingExists = true;

      while (
        bookingExists
      ) {

        bookingId =
          "SK" +
          Math.floor(
            100000 +
            Math.random() *
              900000
          );

        const [existing] =
          await connection.query(
            `
            SELECT id

            FROM bookings

            WHERE booking_id = ?
            `,
            [
              bookingId,
            ]
          );

        bookingExists =
          existing.length > 0;
      }

      // =====================================================
      // CREATE BOOKING
      // =====================================================

      await connection.query(
        `
        INSERT INTO bookings
        (
          booking_id,
          user_id,
          parking_id,
          booking_date,
          arrival_time,
          end_time,
          duration,
          total_price,
          status
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          bookingId,

          req.user.userId,

          parkingId,

          bookingDate,

          normalizedArrivalTime,

          endTime,

          numericDuration,

          calculatedTotalPrice,

          "Active",
        ]
      );

      // =====================================================
      // COMMIT
      // =====================================================

      await connection.commit();

      try {
        const [locationRows] = await db.query("SELECT name FROM parking_locations WHERE id = ?", [parkingId]);
        await createNotification({
          userId: req.user.userId,
          bookingId,
          type: "booking_confirmation",
          title: "Booking Confirmed",
          message: `Your parking booking at ${locationRows[0]?.name || "your selected location"} is confirmed for ${bookingDate} from ${normalizedArrivalTime.slice(0, 5)} to ${endTime.slice(0, 5)}. Booking ID: ${bookingId}.`,
        });
      } catch (notificationError) {
        console.error("Booking confirmation notification error:", notificationError);
      }

      console.log(
        "Booking created successfully:",
        bookingId
      );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.status(201).json({

        message:
          "Booking created successfully",

        bookingId,

        booking: {

          bookingId,

          parkingId:
            Number(parkingId),

          bookingDate,

          arrivalTime:
            normalizedArrivalTime,

          endTime,

          duration:
            numericDuration,

          pricePerHour,

          totalPrice:
            calculatedTotalPrice,

          status:
            "Active",
        },
      });

    } catch (error) {

      // =====================================================
      // ROLLBACK
      // =====================================================

      if (connection) {

        try {

          await connection.rollback();

        } catch (rollbackError) {

          console.error(
            "Rollback error:",
            rollbackError
          );
        }
      }

      console.error(
        "Booking error:",
        error
      );

      return res.status(500).json({

        message:
          "Failed to create booking",

        error:
          error.message,
      });

    } finally {

      if (connection) {
        connection.release();
      }
    }
  }
);

// =========================================================
// CANCEL BOOKING
// =========================================================

app.put(
  "/api/bookings/:bookingId/cancel",
  authenticateToken,
  async (req, res) => {

    let connection;

    try {

      const {
        bookingId,
      } = req.params;

      console.log(
        "Cancelling booking:",
        bookingId
      );

      // =====================================================
      // CONNECTION
      // =====================================================

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      // =====================================================
      // FIND USER BOOKING
      // =====================================================

      const [bookings] =
        await connection.query(
          `
          SELECT
            b.id,
            b.booking_id,
            b.parking_id,
            b.booking_date,
            b.status,
            p.name

          FROM bookings b
          INNER JOIN parking_locations p ON p.id = b.parking_id

          WHERE b.booking_id = ?

          AND b.user_id = ?

          FOR UPDATE
          `,
          [
            bookingId,
            req.user.userId,
          ]
        );

      if (
        bookings.length === 0
      ) {

        await connection.rollback();

        return res.status(404).json({
          message:
            "Booking not found",
        });
      }

      const booking =
        bookings[0];

      // =====================================================
      // CHECK STATUS
      // =====================================================

      if (
        booking.status !==
        "Active"
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "This booking cannot be cancelled",
        });
      }

      // =====================================================
      // CANCEL BOOKING
      // =====================================================

      const [
        cancelResult,
      ] =
        await connection.query(
          `
          UPDATE bookings

          SET status = 'Cancelled'

          WHERE booking_id = ?

          AND user_id = ?

          AND status = 'Active'
          `,
          [
            bookingId,
            req.user.userId,
          ]
        );

      if (
        cancelResult.affectedRows !==
        1
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "Booking could not be cancelled",
        });
      }

      // =====================================================
      // COMMIT
      // =====================================================

      await connection.commit();

      try {
        await createNotification({
          userId: req.user.userId,
          bookingId,
          type: "booking_cancellation",
          title: "Booking Cancelled",
          message: `Your parking booking at ${booking.name} has been cancelled. Booking ID: ${bookingId}.`,
        });
      } catch (notificationError) {
        console.error("Booking cancellation notification error:", notificationError);
      }

      console.log(
        "Booking cancelled successfully:",
        bookingId
      );

      return res.status(200).json({

        message:
          "Booking cancelled successfully",

        bookingId,

        status:
          "Cancelled",
      });

    } catch (error) {

      if (connection) {

        try {

          await connection.rollback();

        } catch (rollbackError) {

          console.error(
            "Rollback error:",
            rollbackError
          );
        }
      }

      console.error(
        "Cancel booking error:",
        error
      );

      return res.status(500).json({

        message:
          "Failed to cancel booking",

        error:
          error.message,
      });

    } finally {

      if (connection) {
        connection.release();
      }
    }
  }
);

// =========================================================
// EXTEND ACTIVE BOOKING BY ONE 30-MINUTE SLOT
// =========================================================

app.put("/api/bookings/:bookingId/extend", authenticateToken, async (req, res) => {
  let connection;

  try {
    const additionalDuration = Number(req.body.additionalDuration || 0.5);
    if (additionalDuration !== 0.5) {
      return res.status(400).json({ message: "Extensions must be 30 minutes" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [bookingRows] = await connection.query(
      `SELECT b.*, p.name, p.total_spots, p.price_per_hour, p.status AS parking_status
       FROM bookings b INNER JOIN parking_locations p ON p.id = b.parking_id
       WHERE b.booking_id = ? AND b.user_id = ? FOR UPDATE`,
      [req.params.bookingId, req.user.userId]
    );

    if (bookingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = bookingRows[0];
    if (booking.status !== "Active" || booking.parking_status?.toLowerCase() === "closed") {
      await connection.rollback();
      return res.status(409).json({ message: "This booking cannot be extended" });
    }

    const now = getIstParts();
    if (toComparableMinutes(booking.booking_date, booking.end_time) <= toComparableMinutes(now.date, now.time)) {
      await connection.rollback();
      return res.status(409).json({ message: "This booking has already ended" });
    }

    const [endHours, endMinutes] = String(booking.end_time).slice(0, 5).split(":").map(Number);
    const nextEndTotal = endHours * 60 + endMinutes + 30;
    if (nextEndTotal > 24 * 60) {
      await connection.rollback();
      return res.status(409).json({ message: "Parking cannot be extended beyond midnight" });
    }

    const nextEndTime = formatTime(Math.floor(nextEndTotal / 60), nextEndTotal % 60);
    const [overlappingRows] = await connection.query(
      `SELECT id FROM bookings
       WHERE parking_id = ? AND booking_date = ? AND status = 'Active'
       AND booking_id <> ? AND arrival_time < ? AND end_time > ? FOR UPDATE`,
      [booking.parking_id, booking.booking_date, booking.booking_id, nextEndTime, booking.end_time]
    );

    if (overlappingRows.length >= Number(booking.total_spots)) {
      await connection.rollback();
      return res.status(409).json({ message: "Parking is not available for the next time slot.", available: false });
    }

    const updatedDuration = Number((Number(booking.duration) + 0.5).toFixed(2));
    const updatedTotalPrice = Number((Number(booking.price_per_hour) * updatedDuration).toFixed(2));
    await connection.query(
      `UPDATE bookings SET end_time = ?, duration = ?, total_price = ?
       WHERE booking_id = ? AND user_id = ? AND status = 'Active'`,
      [nextEndTime, updatedDuration, updatedTotalPrice, booking.booking_id, req.user.userId]
    );

    await createNotification({
      userId: req.user.userId,
      bookingId: booking.booking_id,
      type: "booking_extended",
      title: "Parking Extended",
      message: `Your parking at ${booking.name} has been extended until ${nextEndTime.slice(0, 5)}.`,
      connection,
    });
    await connection.commit();

    res.json({
      message: "Parking booking extended successfully",
      available: true,
      booking: {
        bookingId: booking.booking_id,
        arrivalTime: String(booking.arrival_time).slice(0, 8),
        endTime: nextEndTime,
        duration: updatedDuration,
        totalPrice: updatedTotalPrice,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Extend booking error:", error);
    res.status(500).json({ message: "Failed to extend parking booking" });
  } finally {
    if (connection) connection.release();
  }
});

// =========================================================
// SERVER
// =========================================================

const PORT =
  process.env.PORT || 5000;

ensureNotificationTable()
  .catch((error) => console.error("Notification table setup error:", error))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`SmartKerb backend running on http://localhost:${PORT}`);
    });
  });
