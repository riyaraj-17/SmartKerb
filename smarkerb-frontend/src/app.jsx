import { useEffect, useRef, useState } from "react";
import "./App.css";
import AdminApp from "./AdminApp.jsx";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? "http://localhost:5000"
    : "https://smartkerb-production.up.railway.app");

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",

  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",

  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const createParkingIcon = (status) => {
  let background = "#3f7d4c";

  if (status === "Limited") {
    background = "#d89b28";
  }

  if (status === "Full") {
    background = "#c0392b";
  }

  return L.divIcon({
    className: "custom-parking-marker",

    html: `
      <div
        style="
          width: 36px;
          height: 36px;
          border-radius: 50% 50% 50% 0;
          background: ${background};
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          border: 3px solid white;
        "
      >
        <span
          style="
            transform: rotate(45deg);
            color: white;
            font-weight: 800;
            font-size: 15px;
          "
        >
          P
        </span>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

function App() {

  const [page, setPage] = useState("welcome");

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState("user");

  const [selectedParking, setSelectedParking] = useState(null);
  const [booking, setBooking] = useState(null);

  // =========================================================
  // DATE & TIME HELPERS
  // =========================================================

  const getTodayDate = () => {
    const today = new Date();

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const getCurrentTime = () => {
    const now = new Date();

    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    return `${hours}:${minutes}`;
  };

  // =========================================================
  // RESERVATION STATE
  // =========================================================

  const [bookingDate, setBookingDate] = useState(
    getTodayDate()
  );

  const [arrivalTime, setArrivalTime] = useState("10:30");

  const [duration, setDuration] = useState("1");

  const [selectedDateAvailability, setSelectedDateAvailability] =
    useState(null);

  // =========================================================
  // SMART PARKING SESSION
  // =========================================================

  // The user's single parking session.
  // These values are shared by Smart Recommendation,
  // parking cards and the reservation page.

  const [slotParking, setSlotParking] = useState([]);

  const [slotLoading, setSlotLoading] = useState(false);

  const [slotError, setSlotError] = useState("");

  // =========================================================
  // GENERAL APP STATE
  // =========================================================

  const [search, setSearch] = useState("");

  const [userLocation, setUserLocation] = useState(null);

  const [locationLoading, setLocationLoading] = useState(false);

  const [nearMeActive, setNearMeActive] = useState(false);

  const [bookings, setBookings] = useState([]);

  const [notifications, setNotifications] = useState([]);

  const [notificationOpen, setNotificationOpen] = useState(false);

  const [notificationActionId, setNotificationActionId] = useState(null);

  const notificationRef = useRef(null);

  const [history, setHistory] = useState([]);

  const [parkingSpots, setParkingSpots] = useState([]);

  // =========================================================
  // FORMAT DATE FOR DISPLAY
  // =========================================================

  const formatDisplayDate = (dateString) => {
    if (!dateString) {
      return "";
    }

    const date = new Date(`${dateString}T00:00:00`);

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // =========================================================
  // FIND PARKING FOR SELECTED TIME SLOT
  // =========================================================

  const findParkingForSlot = async () => {
    try {
      setSlotLoading(true);
      setSlotError("");

      const params = new URLSearchParams({
        date: bookingDate,
        arrivalTime,
        duration: String(duration),
      });

      const response = await fetch(
        `${API_BASE}/api/parking?${params.toString()}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to fetch parking"
        );
      }

      setSlotParking(data);
    } catch (error) {
      console.error("Slot parking error:", error);

      setSlotError(
        error.message ||
          "Unable to find parking for this time slot"
      );

      setSlotParking([]);
    } finally {
      setSlotLoading(false);
    }
  };

  // =========================================================
  // TIME SLOT OPTIONS
  // =========================================================

  const generateTimeSlots = () => {
    const slots = [];

    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {

        const time =
          `${String(hour).padStart(2, "0")}:${String(
            minute
          ).padStart(2, "0")}`;

        slots.push(time);
      }
    }

    return slots;
  };

  const timeSlots = generateTimeSlots();

  const formatTime = (time) => {
    if (!time) return "";

    const [hours, minutes] = time
      .split(":")
      .map(Number);

    const date = new Date();

    date.setHours(hours);
    date.setMinutes(minutes);

    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // =========================================================
  // FETCH PARKING DATA
  // =========================================================

  const fetchParkingForSession = async (
    date = bookingDate,
    selectedArrivalTime = arrivalTime,
    selectedDuration = duration
  ) => {
    const params = new URLSearchParams({
      date,
      arrivalTime: selectedArrivalTime,
      duration: String(selectedDuration),
    });

    const response = await fetch(
      `${API_BASE}/api/parking?${params.toString()}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch parking data");
    }

    return data;
  };

  const refreshParkingSpots = async (
    date = bookingDate,
    selectedArrivalTime = arrivalTime,
    selectedDuration = duration
  ) => {
    try {
      const data = await fetchParkingForSession(
        date,
        selectedArrivalTime,
        selectedDuration
      );

      setParkingSpots(
        data.map((parking) => ({
          id: parking.id,
          name: parking.name,
          address: parking.address,
          available: Number(parking.available_spots),
          total: Number(parking.total_spots),
          price: Number(parking.price_per_hour),
          walk: parking.walking_time,
          rating: Number(parking.rating),
          status: parking.status,
          latitude: Number(parking.latitude),
          longitude: Number(parking.longitude),
        }))
      );
    } catch (error) {
      console.error("Error fetching parking:", error);
    }
  };

  useEffect(() => {
    refreshParkingSpots();
  }, [bookingDate, arrivalTime, duration]);

  // =========================================================
  // FETCH DATE-SPECIFIC AVAILABILITY
  // =========================================================

  useEffect(() => {
    if (!selectedParking || !bookingDate) {
      return;
    }

    const fetchAvailability = async () => {
      try {
        const params = new URLSearchParams({
          date: bookingDate,
          arrivalTime: arrivalTime,
          duration: String(duration),
        });

        const response = await fetch(
          `${API_BASE}/api/parking/${selectedParking.id}/availability?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
          console.error(
            "Availability error:",
            data.message
          );

          setSelectedDateAvailability(null);

          return;
        }

        setSelectedDateAvailability(data);
      } catch (error) {
        console.error(
          "Failed to fetch availability:",
          error
        );

        setSelectedDateAvailability(null);
      }
    };

    fetchAvailability();
  }, [selectedParking, bookingDate, arrivalTime, duration]);

  // =========================================================
  // CREATE ACCOUNT
  // =========================================================

  const createAccount = async () => {
    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      alert("Please enter your phone number.");
      return;
    }

    if (password.length < 6) {
      alert("Password must contain at least 6 characters.");
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/api/auth/signup`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            phone: cleanPhone,
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to create account."
        );

        return;
      }

      alert("Account created successfully!");

      setPhone("");
      setPassword("");

      setPage("login");
    } catch (error) {
      console.error("Signup error:", error);

      alert("Unable to connect to the server.");
    }
  };

  // =========================================================
  // LOGIN
  // =========================================================

  const login = async () => {
    const cleanPhone = phone.trim();

    if (!cleanPhone || !password) {
      alert(
        "Please enter your phone number and password."
      );

      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/api/auth/login`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            phone: cleanPhone,
            password: password,
            role: loginRole,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Login failed."
        );

        return;
      }

      localStorage.setItem(
        "smartkerbToken",
        data.token
      );

      if (data.user) {
        localStorage.setItem(
          "smartkerbUser",
          JSON.stringify(data.user)
        );
      }

      setPhone("");
      setPassword("");
      setLoginRole("user");

      setPage(
        data.user?.role === "admin"
          ? "adminDashboard"
          : "dashboard"
      );
    } catch (error) {
      console.error("Login error:", error);

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // LOGOUT
  // =========================================================

  const logout = () => {
    localStorage.removeItem(
      "smartkerbToken"
    );

    localStorage.removeItem(
      "smartkerbUser"
    );

    setPhone("");
    setPassword("");

    setSelectedParking(null);
    setBooking(null);

    setBookings([]);

    setNotifications([]);
    setNotificationOpen(false);

    setHistory([]);

    setBookingDate("");
    setArrivalTime("10:30");
    setDuration("1");

    setSelectedDateAvailability(null);

    setPage("welcome");
  };

  // =========================================================
  // FETCH MY BOOKINGS
  // =========================================================

  const fetchBookings = async () => {
    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/api/bookings`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Failed to fetch bookings:",
          data.message
        );

        return;
      }

      const formattedBookings = data.map(
        (item) => ({
          bookingId: item.booking_id,

          name: item.name,

          address: item.address,

          date: item.booking_date,

          bookingDate: item.booking_date,

          arrivalTime: item.arrival_time,

          duration: Number(
            item.duration
          ),

          totalPrice: Number(
            item.total_price
          ),

          status: item.status,

          parkingId: item.parking_id,

          available: item.available_spots,

          total: item.total_spots,

          price: item.price_per_hour,

          walk: item.walking_time,

          rating: item.rating,
        })
      );

      setBookings(
        formattedBookings
      );
    } catch (error) {
      console.error(
        "Error fetching bookings:",
        error
      );
    }
  };

  const fetchNotifications = async () => {
    const token = localStorage.getItem("smartkerbToken");
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) setNotifications(data);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  };

  const markNotificationRead = async (notificationId) => {
    const token = localStorage.getItem("smartkerbToken");
    if (!token) return;
    await fetch(`${API_BASE}/api/notifications/${notificationId}/read`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((items) => items.map((item) => item.id === notificationId ? { ...item, is_read: 1 } : item));
  };

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem("smartkerbToken");
    if (!token) return;
    await fetch(`${API_BASE}/api/notifications/read-all`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((items) => items.map((item) => ({ ...item, is_read: 1 })));
  };

  const confirmArrival = async (notification) => {
    setNotificationActionId(notification.id);
    try {
      const token = localStorage.getItem("smartkerbToken");
      const response = await fetch(`${API_BASE}/api/notifications/${notification.id}/confirm-arrival`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to confirm arrival");
      await fetchNotifications();
    } catch (error) {
      alert(error.message);
    } finally {
      setNotificationActionId(null);
    }
  };

  const extendBooking = async (notification) => {
    const bookingToExtend = bookings.find((item) => item.bookingId === notification.booking_id);
    if (!bookingToExtend) {
      await fetchBookings();
      alert("Please open My Bookings and try again.");
      return;
    }

    setNotificationActionId(notification.id);
    try {
      const token = localStorage.getItem("smartkerbToken");
      const response = await fetch(`${API_BASE}/api/bookings/${bookingToExtend.bookingId}/extend`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ additionalDuration: 0.5 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Parking not available for the next time slot. Please pick up your vehicle.");

      const updatedBooking = { ...bookingToExtend, ...data.booking };
      setBookings((items) => items.map((item) => item.bookingId === updatedBooking.bookingId ? updatedBooking : item));
      setBooking((current) => current?.bookingId === updatedBooking.bookingId ? { ...current, ...updatedBooking } : current);
      await markNotificationRead(notification.id);
      await fetchNotifications();
      alert(`Parking extended successfully until ${String(data.booking.endTime).slice(0, 5)}.`);
    } catch (error) {
      alert(error.message);
    } finally {
      setNotificationActionId(null);
    }
  };

  useEffect(() => {
    if (page === "welcome" || page === "login" || page === "signup" || page === "adminDashboard") return undefined;
    const initialFetch = setTimeout(fetchNotifications, 0);
    const interval = setInterval(fetchNotifications, 30000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [page]);

  useEffect(() => {
    if (!notificationOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [notificationOpen]);

  // =========================================================
  // FETCH PARKING HISTORY
  // =========================================================

  const fetchHistory = async () => {
    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/api/bookings/history`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Failed to fetch parking history:",
          data.message
        );

        return;
      }

      const formattedHistory = data.map(
        (item) => ({
          bookingId: item.booking_id,

          name: item.name,

          address: item.address,

          date: item.booking_date,

          bookingDate: item.booking_date,

          arrivalTime: item.arrival_time,

          duration: Number(
            item.duration
          ),

          totalPrice: Number(
            item.total_price
          ),

          status: item.status,

          parkingId: item.parking_id,

          available: item.available_spots,

          total: item.total_spots,

          price: item.price_per_hour,

          walk: item.walking_time,

          rating: item.rating,
        })
      );

      setHistory(
        formattedHistory
      );
    } catch (error) {
      console.error(
        "Error fetching parking history:",
        error
      );
    }
  };

  // =========================================================
  // OPEN PARKING DETAILS
  // =========================================================

    const openParkingDetails = async (parking) => {
      setSelectedParking(parking);

      setSelectedDateAvailability(null);

      try {
        const params = new URLSearchParams({
          date: bookingDate,
          arrivalTime: arrivalTime,
          duration: String(duration),
        });

        const response = await fetch(
          `${API_BASE}/api/parking/${parking.id}/availability?${params.toString()}`
        );

        const data = await response.json();

        if (response.ok) {
          setSelectedDateAvailability(data);
        }
      } catch (error) {
        console.error(
          "Failed to check parking availability:",
          error
        );
      }

      setPage("parkingDetails");
    };

  // =========================================================
  // RESERVE PARKING
  // =========================================================

  const reserveSpot = async () => {
    if (!selectedParking) {
      return;
    }

    // -------------------------------------------------------
    // VALIDATE DATE
    // -------------------------------------------------------

    if (!bookingDate) {
      alert(
        "Please select a parking date."
      );

      return;
    }

    // -------------------------------------------------------
    // VALIDATE TIME
    // -------------------------------------------------------

    if (!arrivalTime) {
      alert(
        "Please select your arrival time."
      );

      return;
    }

    // -------------------------------------------------------
    // VALIDATE DURATION
    // -------------------------------------------------------

    const hours = Number(duration);

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      alert(
        "Please select a valid parking duration."
      );

      return;
    }

    // -------------------------------------------------------
    // CHECK DATE-SPECIFIC AVAILABILITY
    // -------------------------------------------------------

    if (
      selectedDateAvailability &&
      Number(
        selectedDateAvailability.availableSpots
      ) <= 0
    ) {
      alert(
        "No parking spots are available for your selected time slot."
      );

      return;
    }

    // -------------------------------------------------------
    // CALCULATE PRICE
    // -------------------------------------------------------

    const totalPrice =
      Number(selectedParking.price) *
      hours;

    // -------------------------------------------------------
    // GET TOKEN
    // -------------------------------------------------------

    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      // -----------------------------------------------------
      // SEND BOOKING TO BACKEND
      // -----------------------------------------------------

      const response = await fetch(
        `${API_BASE}/api/bookings`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`,
          },

          body: JSON.stringify({
            parkingId:
              selectedParking.id,

            bookingDate:
              bookingDate,

            arrivalTime:
              arrivalTime,

            duration:
              hours,

            totalPrice:
              totalPrice,
          }),
        }
      );

      const data =
        await response.json();

      // -----------------------------------------------------
      // HANDLE ERROR
      // -----------------------------------------------------

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to create booking."
        );

        return;
      }

      const availabilityResponse = await fetch(
        `${API_BASE}/api/parking/${selectedParking.id}/availability?${new URLSearchParams({
          date: bookingDate,
          arrivalTime,
          duration: String(hours),
        }).toString()}`
      );

      const refreshedAvailability = await availabilityResponse.json();

      if (!availabilityResponse.ok) {
        throw new Error(
          refreshedAvailability.message ||
            "Failed to refresh parking availability"
        );
      }

      setSelectedDateAvailability(refreshedAvailability);
      await refreshParkingSpots(bookingDate, arrivalTime, hours);

      const updatedParking = {
        ...selectedParking,
        available: Number(refreshedAvailability.availableSpots),
      };

      setSelectedParking(
        updatedParking
      );

      // -----------------------------------------------------
      // CREATE FRONTEND BOOKING OBJECT
      // -----------------------------------------------------

      const newBooking = {
        ...updatedParking,

        bookingId:
          data.bookingId,

        date:
          formatDisplayDate(
            bookingDate
          ),

        bookingDate:
          bookingDate,

        arrivalTime:
          arrivalTime,

        duration:
          hours,

        totalPrice:
          totalPrice,

        status:
          "Active",
      };

      // -----------------------------------------------------
      // UPDATE BOOKING STATE
      // -----------------------------------------------------

      setBooking(
        newBooking
      );

      setBookings(
        (prev) => [
          newBooking,
          ...prev,
        ]
      );

      // -----------------------------------------------------
      // SHOW CONFIRMATION
      // -----------------------------------------------------

      setPage(
        "bookingConfirmed"
      );
    } catch (error) {
      console.error(
        "Booking error:",
        error
      );

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // CANCEL BOOKING
  // =========================================================

  const cancelBooking = async (
    bookingToCancel = booking,
    onSuccess = null
  ) => {
    if (!bookingToCancel) {
      return;
    }

    const confirmCancel =
      window.confirm(
        "Are you sure you want to cancel this reservation?"
      );

    if (!confirmCancel) {
      return;
    }

    const token =
      localStorage.getItem(
        "smartkerbToken"
      );

    if (!token) {
      alert(
        "Please login again."
      );

      setPage("login");

      return;
    }

    try {
      const response =
        await fetch(
          `${API_BASE}/api/bookings/${bookingToCancel.bookingId}/cancel`,
          {
            method: "PUT",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to cancel booking."
        );

        return;
      }

      // -----------------------------------------------------
      // UPDATE LOCAL BOOKING
      // -----------------------------------------------------

      const cancelledBooking = {
        ...bookingToCancel,

        status:
          "Cancelled",
      };

      // -----------------------------------------------------
      // REMOVE FROM ACTIVE BOOKINGS
      // -----------------------------------------------------

      setBookings(
        (prev) =>
          prev.filter(
            (item) =>
              item.bookingId !==
              bookingToCancel.bookingId
          )
      );

      // -----------------------------------------------------
      // ADD TO HISTORY
      // -----------------------------------------------------

      setHistory(
        (prev) => [
          cancelledBooking,
          ...prev,
        ]
      );

      await refreshParkingSpots();

      if (
        bookingToCancel.parkingId &&
        bookingToCancel.bookingDate
      ) {
        const params = new URLSearchParams({
          date: bookingToCancel.bookingDate,
          arrivalTime: bookingToCancel.arrivalTime,
          duration: String(bookingToCancel.duration),
        });

        const availabilityResponse = await fetch(
          `${API_BASE}/api/parking/${bookingToCancel.parkingId}/availability?${params.toString()}`
        );

        if (availabilityResponse.ok) {
          setSelectedDateAvailability(
            await availabilityResponse.json()
          );
        }
      }

      setBooking(null);
      setSelectedParking(null);

      alert(
        "Reservation cancelled successfully."
      );

      if (onSuccess) await onSuccess();
      await fetchNotifications();

      setPage("dashboard");
    } catch (error) {
      console.error(
        "Cancel booking error:",
        error
      );

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // GO TO DASHBOARD
  // =========================================================

  const goToDashboard = () => {
    setSelectedParking(null);

    setSelectedDateAvailability(
      null
    );

    setPage("dashboard");
  };
  
  const calculateDistance = (
    lat1,
    lon1,
    lat2,
    lon2
  ) => {
    const R = 6371;

    const dLat =
      ((lat2 - lat1) * Math.PI) / 180;

    const dLon =
      ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
      Math.cos(
        (lat1 * Math.PI) / 180
      ) *
        Math.cos(
          (lat2 * Math.PI) / 180
        ) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );

    return R * c;
  };

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      alert(
        "Location services are not supported by your browser."
      );

      return;
    }

    setLocationLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        console.log(
          "User location:",
          location
        );

        setUserLocation(location);
        setNearMeActive(true);
        setLocationLoading(false);
      },

      (error) => {
        console.error(
          "Location error:",
          error
        );

        setLocationLoading(false);

        if (error.code === 1) {
          alert(
            "Location permission was denied. Please allow location access in your browser."
          );
        } else if (error.code === 2) {
          alert(
            "Your location could not be determined."
          );
        } else if (error.code === 3) {
          alert(
            "Location request timed out. Please try again."
          );
        } else {
          alert(
            "Unable to access your location."
          );
        }
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  // =========================================================
  // CALCULATE DISTANCE FROM USER
  // =========================================================

  const parkingWithDistance =
    parkingSpots.map((parking) => {
      if (
        !userLocation ||
        parking.latitude == null ||
        parking.longitude == null
      ) {
        return {
          ...parking,
          distance: null,
        };
      }

      const distance =
        calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          parking.latitude,
          parking.longitude
        );

      return {
        ...parking,
        distance,
      };
    });

    // =========================================================
    // SMART RECOMMENDATION
    // =========================================================

    const recommendationCandidates = slotParking
      .filter(
        (parking) =>
          Number(parking.available_spots) > 0 &&
          parking.status !== "Closed"
      )
      .map((parking) => {

        const baseParking = parkingSpots.find(
          (item) => item.id === parking.id
        );

        let distance = null;

        if (
          userLocation &&
          baseParking &&
          baseParking.latitude != null &&
          baseParking.longitude != null
        ) {
          distance = calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            baseParking.latitude,
            baseParking.longitude
          );
        }

        return {
          ...parking,
          distance,
          available: Number(parking.available_spots),
          price: Number(parking.price_per_hour),
          rating: Number(parking.rating),
          walk: parking.walking_time,
        };
      });

    // =========================================================
    // SMART RECOMMENDATION ENGINE
    // =========================================================

    const getRecommendationScore = (parking) => {
      if (parking.available <= 0) {
        return -Infinity;
      }

      let score = 0;

      // -------------------------------------------------------
      // DISTANCE — MOST IMPORTANT
      // -------------------------------------------------------

      if (parking.distance != null) {

        if (parking.distance <= 1) {
          score += 50;
        } else if (parking.distance <= 2) {
          score += 40;
        } else if (parking.distance <= 5) {
          score += 30;
        } else if (parking.distance <= 10) {
          score += 15;
        }

      }

      // -------------------------------------------------------
      // RATING
      // -------------------------------------------------------

      score += (parking.rating / 5) * 25;

      // -------------------------------------------------------
      // PRICE
      // -------------------------------------------------------

      if (parking.price <= 30) {
        score += 15;
      } else if (parking.price <= 50) {
        score += 10;
      } else if (parking.price <= 80) {
        score += 5;
      }

      // -------------------------------------------------------
      // WALKING TIME
      // -------------------------------------------------------

      const walkingText =
        String(parking.walk || "").toLowerCase();

      if (
        walkingText.includes("1") ||
        walkingText.includes("2")
      ) {
        score += 10;
      }

      return score;
    };

    const nearbyRecommendationCandidates =
      nearMeActive
        ? recommendationCandidates.filter(
            (parking) =>
              userLocation &&
              parking.distance != null &&
              parking.distance <= 10
          )
        : recommendationCandidates;

    const recommendedParking =
      nearbyRecommendationCandidates.length > 0
        ? [...nearbyRecommendationCandidates].sort(
            (a, b) =>
              getRecommendationScore(b) -
              getRecommendationScore(a)
          )[0]
        : null;
        
  // =========================================================
  // FILTER PARKING
  // =========================================================

    const filteredParking =
      parkingWithDistance
        .filter((parking) => {
          const matchesSearch =
            parking.name
              .toLowerCase()
              .includes(search.toLowerCase()) ||
            parking.address
              .toLowerCase()
              .includes(search.toLowerCase());

          if (!matchesSearch) {
            return false;
          }

          // When Near Me is active,
          // only show parking within 10 km.
          if (!nearMeActive) {
            return true;
          }

          if (!userLocation) {
            return false;
          }

          if (parking.distance == null) {
            return false;
          }

          return parking.distance <= 10;
        })
        .sort((a, b) => {
          if (
            nearMeActive &&
            a.distance != null &&
            b.distance != null
          ) {
            return a.distance - b.distance;
          }

          return 0;
        });

  // =========================================================
  // DASHBOARD STATS
  // =========================================================

  const totalAvailableSpots =
    parkingSpots.reduce(
      (total, parking) =>
        total +
        Number(
          parking.available || 0
        ),

      0
    );

  const totalParkingZones =
    parkingSpots.length;

  // =========================================================
  // AUTH PAGES
  // =========================================================

  if (
    page === "welcome" ||
    page === "login" ||
    page === "signup"
  ) {
    return (
      <div className="auth-page">

        {/* LEFT SECTION */}

        <div className="auth-left">

          <div className="brand">

            <div className="brand-icon">
              P
            </div>

            <span>
              SmartKerb
            </span>

          </div>

          <div className="hero-content">

            <p className="eyebrow">
              SMART PARKING • REAL TIME
            </p>

            <h1>
              Parking made
              <br />

              <span>
                smarter.
              </span>
            </h1>

            <p>
              Find, reserve and manage
              street parking without the
              hassle of driving around
              looking for a spot.
            </p>

          </div>

          <div className="bottom-text">
            Smart and Effective Real-Time
            Management of Street Parking
          </div>

        </div>

        {/* RIGHT SECTION */}

        <div className="auth-right">

          {/* WELCOME */}

          {page === "welcome" && (
            <div className="auth-card">

              <div className="mobile-brand">

                <div className="brand-icon">
                  P
                </div>

                <span>
                  SmartKerb
                </span>

              </div>

              <p className="card-eyebrow">
                WELCOME TO SMARTKERB
              </p>

              <h2>
                Park smarter.
              </h2>

              <p className="subtitle">
                Your parking spot is
                just a few taps away.
              </p>

              <button
                className="primary-btn"
                onClick={() =>
                  setPage("login")
                }
              >
                Login
              </button>

              <button
                className="secondary-btn"
                onClick={() =>
                  setPage("signup")
                }
              >
                Create Account
              </button>

            </div>
          )}

          {/* LOGIN */}

          {page === "login" && (
            <div className="auth-card">

              <button
                className="back-btn"
                onClick={() =>
                  setPage("welcome")
                }
              >
                ← Back
              </button>

              <p className="card-eyebrow">
                WELCOME BACK
              </p>

              <h2>
                Login
              </h2>

              <p className="subtitle">
                Enter your phone number
                and password.
              </p>

              <div className="form-group">

                <label>
                  Phone Number
                </label>

                <input
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) =>
                    setPhone(
                      e.target.value
                    )
                  }
                />

              </div>

              <div className="form-group">

                <label>
                  Login As
                </label>

                <select
                  value={loginRole}
                  onChange={(e) =>
                    setLoginRole(e.target.value)
                  }
                >
                  <option value="user">
                    User
                  </option>

                  <option value="admin">
                    Admin
                  </option>
                </select>

              </div>

              <div className="form-group">

                <label>
                  Password
                </label>

                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                />

              </div>

              <button
                className="primary-btn"
                onClick={login}
              >
                Login
              </button>

              <p className="switch-text">

                Don't have an account?

                <button
                  onClick={() => {
                    setPhone("");
                    setPassword("");
                    setPage("signup");
                  }}
                >
                  Create account
                </button>

              </p>

            </div>
          )}

          {/* SIGNUP */}

          {page === "signup" && (
            <div className="auth-card">

              <button
                className="back-btn"
                onClick={() =>
                  setPage("welcome")
                }
              >
                ← Back
              </button>

              <p className="card-eyebrow">
                CREATE ACCOUNT
              </p>

              <h2>
                Let's get started.
              </h2>

              <p className="subtitle">
                Create your SmartKerb
                account using your
                phone number.
              </p>

              <div className="form-group">

                <label>
                  Phone Number
                </label>

                <input
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) =>
                    setPhone(
                      e.target.value
                    )
                  }
                />

              </div>

              <div className="form-group">

                <label>
                  Create Password
                </label>

                <input
                  type="password"
                  placeholder="Create password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                />

              </div>

              <button
                className="primary-btn"
                onClick={createAccount}
              >
                Create Account
              </button>

              <p className="switch-text">

                Already have an account?

                <button
                  onClick={() => {
                    setPhone("");
                    setPassword("");
                    setPage("login");
                  }}
                >
                  Login
                </button>

              </p>

            </div>
          )}

        </div>

      </div>
    );
  }

  // =========================================================
  // MAIN APP
  // =========================================================

  if (page === "adminDashboard") {
    return (
      <AdminApp
        user={JSON.parse(localStorage.getItem("smartkerbUser") || "null")}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="app">

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <header className="dashboard-nav">

        <div className="dashboard-logo">

          <div className="brand-icon">
            P
          </div>

          <span>
            SmartKerb
          </span>

        </div>

        <nav className="dashboard-menu">

          <button
            className={
              page === "dashboard"
                ? "active-nav"
                : ""
            }
            onClick={goToDashboard}
          >
            Dashboard
          </button>

          <button
            className={
              page === "myBookings"
                ? "active-nav"
                : ""
            }
            onClick={() => {
              fetchBookings();
              setPage("myBookings");
            }}
          >
            My Bookings
          </button>

          <button
            className={
              page === "history"
                ? "active-nav"
                : ""
            }
            onClick={() => {
              fetchHistory();
              setPage("history");
            }}
          >
            Parking History
          </button>

        </nav>

        <div className="dashboard-profile">

          <div className="notification-wrapper" ref={notificationRef}>
            <button
              className="notification-button"
              type="button"
              aria-label="Open notifications"
              aria-expanded={notificationOpen}
              onClick={() => setNotificationOpen((open) => !open)}
            >
              <span aria-hidden="true">🔔</span>
              {notifications.some((item) => !item.is_read) && (
                <span className="notification-badge">
                  {notifications.filter((item) => !item.is_read).length}
                </span>
              )}
            </button>

            {notificationOpen && (
              <div className="notification-panel">
                <div className="notification-panel-header">
                  <strong>Notifications</strong>
                  <button type="button" onClick={markAllNotificationsRead}>Mark all as read</button>
                </div>

                {notifications.length === 0 ? (
                  <p className="notification-empty">No new notifications.</p>
                ) : (
                  <div className="notification-list">
                    {notifications.map((notification) => {
                      const linkedBooking = bookings.find((item) => item.bookingId === notification.booking_id);
                      const isArrivalReminder = notification.type === "arrival_reminder" && linkedBooking;
                      const isEndingReminder = notification.type === "ending_soon" && linkedBooking;
                      return (
                        <article className={`notification-item ${notification.is_read ? "read" : "unread"}`} key={notification.id}>
                          <button type="button" className="notification-item-main" onClick={() => markNotificationRead(notification.id)}>
                            <span className="notification-item-icon" aria-hidden="true">{notification.type === "booking_cancellation" ? "×" : "✓"}</span>
                            <span>
                              <strong>{notification.title}</strong>
                              <span>{notification.message}</span>
                              <small>{new Date(notification.created_at).toLocaleString("en-IN")}</small>
                            </span>
                          </button>
                          {(isArrivalReminder || isEndingReminder) && (
                            <div className="notification-actions">
                              {isArrivalReminder && <button type="button" onClick={() => confirmArrival(notification)} disabled={notificationActionId === notification.id}>Yes, I&apos;m coming</button>}
                              {isArrivalReminder && <button type="button" onClick={() => cancelBooking(linkedBooking, () => markNotificationRead(notification.id))} disabled={notificationActionId === notification.id}>Cancel Booking</button>}
                              {isEndingReminder && <button type="button" onClick={() => { markNotificationRead(notification.id); alert(`Reminder noted. Please pick up your vehicle before ${String(linkedBooking.endTime || "").slice(0, 5)}.`); }} disabled={notificationActionId === notification.id}>Pick Up Vehicle</button>}
                              {isEndingReminder && <button type="button" onClick={() => extendBooking(notification)} disabled={notificationActionId === notification.id}>{notificationActionId === notification.id ? "Checking availability..." : "Extend Parking"}</button>}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="avatar">
            R
          </div>

          <button
            className="logout-dashboard"
            onClick={logout}
          >
            Logout
          </button>

        </div>

      </header>

      {/* =====================================================
          DASHBOARD
      ===================================================== */}

      {page === "dashboard" && (
        <main className="dashboard-main">

          <section className="dashboard-welcome">

            <p className="dashboard-label">
              SMART PARKING • LIVE
            </p>

            <h1>
              Find your perfect
              <br />

              <span>
                parking spot.
              </span>
            </h1>

            <p>
              Real-time parking
              availability around you.
            </p>

          </section>

          {/* SEARCH */}

          <section className="parking-search">

            <div className="search-input">

              <span>
                ⌕
              </span>

              <input
                type="text"
                placeholder="Search parking location..."
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
              />

            </div>

            <button
              className="near-me-btn"
              onClick={handleNearMe}
            >
              {locationLoading
                ? "Locating..."
                : nearMeActive
                ? "Near Me ✓"
                : "Near Me"}
            </button>

          </section>

          {/* STATS */}

          <section className="dashboard-stats">

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot green"></span>

              </div>

              <div>

                <h3>
                  {totalAvailableSpots}
                </h3>

                <p>
                  Available spots
                </p>

              </div>

            </div>

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot yellow"></span>

              </div>

              <div>

                <h3>
                  {totalParkingZones}
                </h3>

                <p>
                  Parking zones
                </p>

              </div>

            </div>

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot green"></span>

              </div>

              <div>

                <h3>
                  LIVE
                </h3>

                <p>
                  Availability
                </p>

              </div>

            </div>

          </section>

          {/* =====================================================
              SMART RECOMMENDATION
          ===================================================== */}

          <section className="smart-recommendation">

            <div className="recommendation-header">

              <div className="recommendation-star">
                ✦
              </div>

              <div className="recommendation-copy">
                <small>
                  SMART RECOMMENDATION
                </small>

                <h2>
                  Find the best parking for you
                </h2>

                <p>
                  Tell us when you're parking and we'll choose the best available spot.
                </p>
              </div>

            </div>

            {/* =================================================
                PARKING SESSION
            ================================================= */}

            <div className="slot-controls">

              <div className="slot-controls-heading">
                <span>Parking session</span>
                <small>Set your arrival details</small>
              </div>

              {/* DATE */}

              <div className="slot-field">

                <label>
                  Date
                </label>

                <input
                  type="date"
                  value={bookingDate}
                  min={getTodayDate()}
                  onChange={(e) => {
                    setBookingDate(e.target.value);
                    setSelectedDateAvailability(null);
                    setSlotParking([]);
                  }}
                />

              </div>

              {/* TIME */}

              <div className="slot-field">

                <label>
                  Arrival
                </label>

                <select
                  value={arrivalTime}
                  onChange={(e) => {
                    setArrivalTime(e.target.value);
                    setSelectedDateAvailability(null);
                    setSlotParking([]);
                  }}
                >

                  {timeSlots.map((time) => (
                    <option
                      key={time}
                      value={time}
                    >
                      {formatTime(time)}
                    </option>
                  ))}

                </select>

              </div>


              {/* DURATION */}

              <div className="slot-field">

                <label>
                  Duration
                </label>

                <select
                  value={duration}
                  onChange={(e) => {
                    setDuration(e.target.value);
                    setSelectedDateAvailability(null);
                    setSlotParking([]);
                  }}
                >

                  <option value={1}>
                    1 hour
                  </option>

                  <option value={2}>
                    2 hours
                  </option>

                  <option value={3}>
                    3 hours
                  </option>

                  <option value={4}>
                    4 hours
                  </option>

                  <option value={5}>
                    5 hours
                  </option>

                </select>

              </div>


              <button
                className="find-parking-btn"
                onClick={findParkingForSlot}
                disabled={slotLoading}
              >
                {slotLoading
                  ? "Finding..."
                  : "Find Best Parking →"}
              </button>

            </div>


            {/* ERROR */}

            {slotError && (
              <div className="slot-error">
                {slotError}
              </div>
            )}


            {/* =================================================
                RECOMMENDATION RESULT
            ================================================= */}

            {slotParking.length > 0 && (

              <div className="recommendation-result">

                {recommendedParking ? (

                  <>

                    <div className="recommendation-result-info">

                      <span className="best-match-label">
                        ✦ BEST MATCH
                      </span>

                      <h3>
                        {recommendedParking.name}
                      </h3>

                      <p>
                        {recommendedParking.address}
                      </p>

                      <div className="parking-meta">

                        {recommendedParking.distance != null && (
                          <span>
                            📍 {recommendedParking.distance.toFixed(1)} km
                          </span>
                        )}

                        <span>
                          🅿 {recommendedParking.available} spots
                        </span>

                        <span>
                          ₹{recommendedParking.price}/hr
                        </span>

                        <span>
                          ⭐ {recommendedParking.rating}
                        </span>
                        
                        <p className="recommendation-reason">
                          Best match based on availability, distance, price and rating.
                        </p>

                      </div>

                    </div>


                    <button
                      className="recommendation-book-btn"
                      onClick={() => {
                        const selected = {
                          ...recommendedParking,

                          id: recommendedParking.id,

                          name: recommendedParking.name,

                          address: recommendedParking.address,

                          available:
                            recommendedParking.available,

                          total:
                            Number(
                              recommendedParking.total_spots
                            ),

                          price:
                            recommendedParking.price,

                          walk:
                            recommendedParking.walk,

                          rating:
                            recommendedParking.rating,
                        };

                        openParkingDetails(selected);
                      }}
                    >
                      Book Now →
                    </button>

                  </>

                ) : (

                  <div className="no-recommendation">

                    <h3>
                      No parking available
                    </h3>

                    <p>
                      No parking spots are available
                      for your selected session.
                    </p>

                  </div>

                )}

              </div>

            )}

          </section>

          {/* PARKING */}

          <section className="parking-section">

            <div className="parking-section-header">

              <div>

                <h2>
                  Nearby parking
                </h2>

                <p>
                  Parking availability
                  updated in real time
                </p>

              </div>

              <button
                className="view-map-btn"
                onClick={() => {
                  document
                    .getElementById("live-parking-map")
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                }}
              >
                View Map →
              </button>

            </div>

            {filteredParking.length === 0 ? (

              <div className="no-results">
                {nearMeActive
                  ? "No parking locations found within 10 km of your current location."
                  : "No parking location found."}
              </div>

            ) : (

              <div className="parking-cards">

                {filteredParking.map(
                  (parking) => (

                    <div
                      className="parking-card"
                      key={parking.id}
                    >

                      <div className="parking-card-header">

                        <div className="parking-place-icon">
                          P
                        </div>

                        <span
                          className={
                            parking.status ===
                            "Available"
                              ? "available-tag"
                              : "limited-tag"
                          }
                        >

                          <span
                            className={
                              parking.status ===
                              "Available"
                                ? "status-dot green"
                                : "status-dot yellow"
                            }
                          />

                          {parking.status}

                        </span>

                      </div>

                      <h3>
                        {parking.name}
                      </h3>

                      <p className="parking-address">
                        {parking.address}
                      </p>

                      <div className="parking-info">

                        <div>

                          <strong>
                            {parking.available}
                          </strong>

                          <span>
                            / {parking.total} spots for selected slot
                          </span>

                        </div>

                        <div>

                          <strong>
                            ₹{parking.price}
                          </strong>

                          <span>
                            / hour
                          </span>

                        </div>

                      </div>

                      <div className="parking-bottom">

                        <span>
                          {nearMeActive &&
                          parking.distance != null
                            ? `${parking.distance.toFixed(1)} km away`
                            : `${parking.walk} walk`}
                        </span>

                        <span>
                          {parking.rating} rating
                        </span>
                        
                      </div>

                      <button
                        className="parking-view-btn"
                        onClick={() =>
                          openParkingDetails(
                            parking
                          )
                        }
                      >
                        View Parking
                      </button>

                    </div>

                  )
                )}

              </div>

            )}

          </section>

          {/* MAP */}

          <section
            className="live-map-section"
            id="live-parking-map"
          >

              <div className="parking-section-header">

                <div>

                  <h2>
                    Live parking map
                  </h2>

                  <p>
                    Monitor parking availability
                    across Bengaluru
                  </p>

                </div>

              </div>

              <div className="real-map-wrapper">

                <MapContainer
                  center={[12.9716, 77.5946]}
                  zoom={12}
                  scrollWheelZoom={true}
                  className="real-map"
                >

                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {userLocation && (
                    <CircleMarker
                      center={[
                        userLocation.latitude,
                        userLocation.longitude,
                      ]}
                      radius={10}
                      pathOptions={{
                        color: "#2563eb",
                        fillColor: "#2563eb",
                        fillOpacity: 0.8,
                      }}
                    >
                      <Popup>
                        <strong>
                          You are here
                        </strong>
                      </Popup>
                    </CircleMarker>
                  )}

                  {parkingSpots
                    .filter(
                      (parking) =>
                        Number.isFinite(parking.latitude) &&
                        Number.isFinite(parking.longitude)
                    )
                    .map((parking) => (

                      <Marker
                        key={parking.id}
                        position={[
                          parking.latitude,
                          parking.longitude,
                        ]}
                        icon={createParkingIcon(
                          parking.status
                        )}
                      >

                        <Popup>

                          <div className="parking-popup">

                            <h3>
                              {parking.name}
                            </h3>

                            <p>
                              {parking.address}
                            </p>

                            <div className="popup-availability">

                              <strong>
                                {parking.available}
                              </strong>

                              <span>
                                / {parking.total} spots for selected slot
                              </span>

                            </div>

                            <p>
                              ₹{parking.price}/hour
                            </p>

                            <p>
                              ⭐ {parking.rating}
                            </p>

                            <button
                              className="popup-book-btn"
                              onClick={() =>
                                openParkingDetails(
                                  parking
                                )
                              }
                            >
                              View Parking
                            </button>

                          </div>

                        </Popup>

                      </Marker>

                    ))}

                </MapContainer>

                <div className="map-legend">

                  <span>
                    <span className="status-dot green" />
                    Available
                  </span>

                  <span>
                    <span className="status-dot yellow" />
                    Limited
                  </span>

                  <span>
                    <span className="status-dot red" />
                    Full
                  </span>

                </div>

              </div>

            </section>

          <button
            className="dashboard-logout-bottom"
            onClick={logout}
          >
            Logout from SmartKerb
          </button>

        </main>
      )}

      {/* =====================================================
          PARKING DETAILS / RESERVATION
      ===================================================== */}

      {page === "parkingDetails" &&
        selectedParking && (

          <div className="details-page-wrapper">

            <main className="parking-details-page">

              <button
                className="back-btn"
                onClick={goToDashboard}
                style={{
                  marginBottom:
                    "20px",
                }}
              >
                ← Back to Dashboard
              </button>

              <h2>
                RESERVE YOUR SPOT
              </h2>

              <div className="reservation-section">

                <h3>
                  Your parking session
                </h3>

                <p>
                  Your selected date, arrival time and duration are carried forward automatically.
                </p>

                {/* =================================================
                    SESSION SUMMARY
                ================================================= */}

                <div
                  style={{
                    marginBottom: "20px",
                    padding: "18px",
                    borderRadius: "14px",
                    background: "#f4f7f3",
                    border: "1px solid #dce5db",
                  }}
                >

                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#6c756e",
                      marginBottom: "12px",
                      letterSpacing: "0.5px",
                    }}
                  >
                    YOUR PARKING SESSION
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "24px",
                      flexWrap: "wrap",
                    }}
                  >

                    <div>
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "#7a827b",
                          marginBottom: "4px",
                        }}
                      >
                        Date
                      </span>

                      <strong>
                        📅 {formatDisplayDate(bookingDate)}
                      </strong>
                    </div>

                    <div>
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "#7a827b",
                          marginBottom: "4px",
                        }}
                      >
                        Arrival
                      </span>

                      <strong>
                        🕐 {formatTime(arrivalTime)}
                      </strong>
                    </div>

                    <div>
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "#7a827b",
                          marginBottom: "4px",
                        }}
                      >
                        Duration
                      </span>

                      <strong>
                        ⏱️ {duration}{" "}
                        {Number(duration) === 1
                          ? "hour"
                          : "hours"}
                      </strong>
                    </div>

                  </div>

                  <div
                    style={{
                      marginTop: "16px",
                      paddingTop: "14px",
                      borderTop: "1px solid #dce5db",
                      fontSize: "14px",
                      fontWeight: "600",
                      color:
                        selectedDateAvailability &&
                        Number(
                          selectedDateAvailability.availableSpots
                        ) === 0
                          ? "#c0392b"
                          : "#3f7d4c",
                    }}
                  >

                    {selectedDateAvailability
                      ? `${selectedDateAvailability.availableSpots} of ${selectedDateAvailability.totalSpots} spots available for this session`
                      : "Checking availability..."}

                  </div>

                </div>

                {/* =================================================
                    TOTAL PRICE
                ================================================= */}

                <div className="booking-total">

                  <span>
                    Estimated parking cost
                  </span>

                  <strong>
                    ₹
                    {Number(
                      selectedParking.price
                    ) *
                      Number(
                        duration
                      )}
                  </strong>

                </div>

                {/* =================================================
                    INFORMATION
                ================================================= */}

                <div className="reservation-details-grid">

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Available spots
                    </span>

                    <strong>
                      {selectedDateAvailability
                        ? selectedDateAvailability.availableSpots
                        : selectedParking.available}

                      {" / "}

                      {selectedParking.total}
                    </strong>

                    <small>
                      for selected date
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Parking price
                    </span>

                    <strong>
                      ₹
                      {
                        selectedParking.price
                      }
                    </strong>

                    <small>
                      per hour
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Walking distance
                    </span>

                    <strong>
                      {
                        selectedParking.walk
                      }
                    </strong>

                    <small>
                      from your location
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Parking rating
                    </span>

                    <strong>
                      ★{" "}
                      {
                        selectedParking.rating
                      }
                    </strong>

                    <small>
                      customer rating
                    </small>

                  </div>

                </div>

                {/* =================================================
                    RESERVE BUTTON
                ================================================= */}

                <button
                  className="reserve-btn"
                  onClick={
                    reserveSpot
                  }
                  disabled={
                    selectedDateAvailability &&
                    Number(
                      selectedDateAvailability.availableSpots
                    ) <= 0
                  }
                  style={{
                    opacity:
                      selectedDateAvailability &&
                      Number(
                        selectedDateAvailability.availableSpots
                      ) <= 0
                        ? 0.5
                        : 1,

                    cursor:
                      selectedDateAvailability &&
                      Number(
                        selectedDateAvailability.availableSpots
                      ) <= 0
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {selectedDateAvailability &&
                  Number(
                    selectedDateAvailability.availableSpots
                  ) <= 0
                    ? "No Spots Available"
                    : "Reserve Now"}
                </button>

              </div>

            </main>

          </div>
        )}

      {/* =====================================================
          BOOKING CONFIRMED
      ===================================================== */}

      {page ===
        "bookingConfirmed" &&
        booking && (

          <main className="parking-details-page confirmation-page">

            <div className="success-icon">
              ✓
            </div>

            <p className="card-eyebrow">
              RESERVATION CONFIRMED
            </p>

            <h1 className="details-title">
              Spot reserved!
            </h1>

            <p className="details-address">
              Your parking spot at{" "}
              {booking.name} has been
              successfully reserved.
            </p>

            <div className="confirmation-card">

              <div className="confirmation-header">

                <div className="parking-place-icon">
                  P
                </div>

                <div>

                  <h2>
                    {booking.name}
                  </h2>

                  <p>
                    {booking.address}
                  </p>

                </div>

              </div>

              <div className="confirmation-details">

                <div>

                  <span>
                    Booking ID
                  </span>

                  <strong>
                    {booking.bookingId}
                  </strong>

                </div>

                <div>

                  <span>
                    Date
                  </span>

                  <strong>
                    {booking.date}
                  </strong>

                </div>

                <div>

                  <span>
                    Arrival time
                  </span>

                  <strong>
                    {booking.arrivalTime}
                  </strong>

                </div>

                <div>

                  <span>
                    Duration
                  </span>

                  <strong>
                    {booking.duration} hour
                    {booking.duration >
                    1
                      ? "s"
                      : ""}
                  </strong>

                </div>

                <div>

                  <span>
                    Total price
                  </span>

                  <strong>
                    ₹
                    {
                      booking.totalPrice
                    }
                  </strong>

                </div>

              </div>

              <div className="confirmation-message">

                <strong>
                  Your spot is waiting for you.
                </strong>

                <p>
                  Please arrive at{" "}
                  {booking.name} around
                  your selected arrival time.
                </p>

              </div>

              <div className="confirmation-buttons">

                <button
                  className="cancel-booking-btn"
                  onClick={
                    cancelBooking
                  }
                >
                  Cancel Reservation
                </button>

                <button
                  className="primary-btn"
                  onClick={() => {
                    fetchBookings();

                    setPage(
                      "myBookings"
                    );
                  }}
                >
                  View My Booking
                </button>

                <button
                  className="secondary-btn"
                  onClick={
                    goToDashboard
                  }
                >
                  Back to Dashboard
                </button>

              </div>

            </div>

          </main>
        )}

      {/* =====================================================
          MY BOOKINGS
      ===================================================== */}

      {page ===
        "myBookings" && (

        <main className="parking-details-page">

          <p className="card-eyebrow">
            MY BOOKINGS
          </p>

          <h1 className="details-title">
            Your reservations
          </h1>

          <p className="details-address">
            Manage your active parking
            reservations.
          </p>

          {bookings.length ===
          0 ? (

            <div className="empty-state">

              <div className="empty-icon">
                P
              </div>

              <h2>
                No active bookings
              </h2>

              <p>
                You haven't reserved a
                parking spot yet.
              </p>

              <button
                className="primary-btn"
                onClick={
                  goToDashboard
                }
              >
                Find Parking
              </button>

            </div>

          ) : (

            <div className="booking-list">

              {bookings.map(
                (item) => (

                  <div
                    className="booking-card"
                    key={
                      item.bookingId
                    }
                  >

                    <div>

                      <h2>
                        {item.name}
                      </h2>

                      <p>
                        {item.address}
                      </p>

                    </div>

                    <div className="booking-info">

                      <span>
                        Date
                      </span>

                      <strong>
                        {
                          item.date
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Arrival
                      </span>

                      <strong>
                        {
                          item.arrivalTime
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Duration
                      </span>

                      <strong>
                        {
                          item.duration
                        }{" "}
                        hr
                      </strong>

                    </div>

                    <div className="booking-price">

                      <span>
                        Total
                      </span>

                      <strong>
                        ₹
                        {
                          item.totalPrice
                        }
                      </strong>

                    </div>

                    <button
                      className="cancel-btn"
                      onClick={() =>
                        cancelBooking(
                          item
                        )
                      }
                    >
                      Cancel
                    </button>

                  </div>
                )
              )}

            </div>
          )}

          <button
            className="page-secondary-btn"
            onClick={
              goToDashboard
            }
          >
            ← Back to Dashboard
          </button>

        </main>
      )}

      {/* =====================================================
          PARKING HISTORY
      ===================================================== */}

      {page ===
        "history" && (

        <main className="parking-details-page">

          <p className="card-eyebrow">
            PARKING HISTORY
          </p>

          <h1 className="details-title">
            Your parking history
          </h1>

          <p className="details-address">
            View your previous parking activity.
          </p>

          {history.length ===
          0 ? (

            <div className="empty-state">

              <div className="empty-icon">
                ↺
              </div>

              <h2>
                No parking history
              </h2>

              <p>
                Your completed or cancelled
                reservations will appear
                here.
              </p>

              <button
                className="primary-btn"
                onClick={
                  goToDashboard
                }
              >
                Find Parking
              </button>

            </div>

          ) : (

            <div className="booking-list">

              {history.map(
                (
                  item,
                  index
                ) => (

                  <div
                    className="booking-card"
                    key={`${item.bookingId}-${index}`}
                  >

                    <div>

                      <h2>
                        {item.name}
                      </h2>

                      <p>
                        {item.address}
                      </p>

                    </div>

                    <div className="booking-info">

                      <span>
                        Date
                      </span>

                      <strong>
                        {
                          item.date
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Arrival
                      </span>

                      <strong>
                        {
                          item.arrivalTime
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Duration
                      </span>

                      <strong>
                        {
                          item.duration
                        }{" "}
                        hr
                      </strong>

                    </div>

                    <div className="booking-price">

                      <span>
                        Total
                      </span>

                      <strong>
                        ₹
                        {
                          item.totalPrice
                        }
                      </strong>

                    </div>

                    <span
                      className={`history-status ${
                        item.status ===
                        "Active"
                          ? "active"
                          : "cancelled"
                      }`}
                    >
                      {
                        item.status
                      }
                    </span>

                  </div>
                )
              )}

            </div>
          )}

          <button
            className="page-secondary-btn"
            onClick={
              goToDashboard
            }
          >
            ← Back to Dashboard
          </button>

        </main>
      )}

    </div>
  );
}

export default App;
