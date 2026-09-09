import { useEffect, useState } from "react";
import "./Admin.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? "http://localhost:5000"
    : "https://smartkerb-production.up.railway.app");

const initialSummary = {
  totalParkingLocations: 0,
  activeParkingLocations: 0,
  closedParkingLocations: 0,
  availableSpots: 0,
  occupiedSpots: 0,
  todayBookings: 0,
  todayRevenue: 0,
  utilization: 0,
};

const emptyLocationForm = {
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  capacity: "",
  pricePerHour: "",
  status: "Open",
};

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN")}`;

const localDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getAnalyticsRange = (period, customStart, customEnd) => {
  const end = new Date();
  const endDate = localDateString(end);

  if (period === "custom") {
    return { startDate: customStart, endDate: customEnd };
  }

  const days = period === "today" ? 1 : period === "30" ? 30 : 7;
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { startDate: localDateString(start), endDate };
};

function AnalyticsEmpty({ message = "No data for this period" }) {
  return <div className="analytics-empty">{message}</div>;
}

function TrendChart({ trends, valueKey, color, currency = false }) {
  if (trends.length === 0) return <AnalyticsEmpty />;
  const values = trends.map((item) => Number(item[valueKey] || 0));
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = trends.length === 1 ? 50 : (index / (trends.length - 1)) * 100;
      const y = 100 - (value / max) * 82 - 9;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="trend-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${valueKey} trend`}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="trend-labels">
        {trends.map((item) => <span key={item.date}>{item.date.slice(5)}</span>)}
      </div>
      <div className="trend-values">
        <strong>{currency ? formatCurrency(Math.max(...values)) : Math.max(...values)}</strong>
        <span>peak in range</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, detail, tone = "default" }) {
  return (
    <article className={`admin-stat-card admin-stat-${tone}`}>
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value}</strong>
      <span className="admin-stat-detail">{detail}</span>
    </article>
  );
}

function AdminApp({ user, onLogout }) {
  const [activeView, setActiveView] = useState("dashboard");
  const [summary, setSummary] = useState(initialSummary);
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("All");
  const [locationModal, setLocationModal] = useState(false);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationActionId, setLocationActionId] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState("");
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatus, setBookingStatus] = useState("All");
  const [bookingDate, setBookingDate] = useState("");
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsPeriod, setAnalyticsPeriod] = useState("7");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [operations, setOperations] = useState(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState("");
  const [confirmStatusChange, setConfirmStatusChange] = useState(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchSummary = async () => {
    const token = localStorage.getItem("smartkerbToken");

    if (!token || user?.role !== "admin") {
      onLogout();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_BASE}/api/admin/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load admin dashboard");
      }

      setSummary({ ...initialSummary, ...data });
      setLastUpdated(new Date());
    } catch (fetchError) {
      setError(fetchError.message || "Unable to load admin dashboard");
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    const token = localStorage.getItem("smartkerbToken");

    if (!token || user?.role !== "admin") {
      onLogout();
      return;
    }

    try {
      setLocationsLoading(true);
      setLocationsError("");
      const response = await fetch(`${API_BASE}/api/admin/parking`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load parking locations");
      }

      setLocations(data);
      setLastUpdated(new Date());
    } catch (fetchError) {
      setLocationsError(fetchError.message || "Unable to load parking locations");
    } finally {
      setLocationsLoading(false);
    }
  };

  const openLocationModal = (location = null) => {
    setLocationForm(
      location
        ? {
            name: location.name || "",
            address: location.address || "",
            latitude: location.latitude ?? "",
            longitude: location.longitude ?? "",
            capacity: location.totalSpots ?? "",
            pricePerHour: location.pricePerHour ?? "",
            status: location.locationStatus || "Open",
          }
        : emptyLocationForm
    );
    setLocationModal(location || "new");
  };

  const saveLocation = async (event) => {
    event.preventDefault();
    const token = localStorage.getItem("smartkerbToken");

    try {
      setLocationSaving(true);
      const isEditing = locationModal !== "new";
      const endpoint = isEditing
        ? `${API_BASE}/api/admin/parking/${locationModal.id}`
        : `${API_BASE}/api/admin/parking`;
      const response = await fetch(endpoint, {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(locationForm),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to save parking location");
      }

      setLocationModal(null);
      await Promise.all([fetchLocations(), fetchSummary()]);
      await fetchOperations();
      setToast(`${isEditing ? "Location updated" : "Location added"} successfully.`);
    } catch (saveError) {
      setLocationsError(saveError.message || "Unable to save parking location");
    } finally {
      setLocationSaving(false);
    }
  };

  const changeLocationStatus = async (location) => {
    const token = localStorage.getItem("smartkerbToken");
    const nextStatus = location.locationStatus === "Closed" ? "Open" : "Closed";

    try {
      setLocationActionId(location.id);
      const response = await fetch(`${API_BASE}/api/admin/parking/${location.id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to update parking status");
      }

      await Promise.all([fetchLocations(), fetchSummary(), fetchOperations()]);
      setToast(`${nextStatus === "Closed" ? "Location closed" : "Location reopened"}: ${location.name}`);
      setConfirmStatusChange(null);
    } catch (statusError) {
      setLocationsError(statusError.message || "Unable to update parking status");
    } finally {
      setLocationActionId(null);
    }
  };

  const requestLocationStatusChange = (location) => {
    setConfirmStatusChange({
      location,
      nextStatus: location.locationStatus === "Closed" ? "Open" : "Closed",
    });
  };

  const fetchOperations = async () => {
    const token = localStorage.getItem("smartkerbToken");

    try {
      setOperationsLoading(true);
      setOperationsError("");
      const response = await fetch(`${API_BASE}/api/admin/operations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load operations data");
      }

      setOperations(data);
      setLastUpdated(new Date());
    } catch (fetchError) {
      setOperationsError(fetchError.message || "Unable to load operations data");
    } finally {
      setOperationsLoading(false);
    }
  };

  const refreshDashboard = async () => {
    await Promise.all([fetchSummary(), fetchOperations()]);
  };

  const fetchBookings = async () => {
    const token = localStorage.getItem("smartkerbToken");

    try {
      setBookingsLoading(true);
      setBookingsError("");
      const params = new URLSearchParams();
      if (bookingSearch.trim()) params.set("search", bookingSearch.trim());
      if (bookingStatus !== "All") params.set("status", bookingStatus);
      if (bookingDate) params.set("date", bookingDate);
      const response = await fetch(`${API_BASE}/api/admin/bookings?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.message || "Unable to load bookings");
      setBookings(data);
    } catch (fetchError) {
      setBookingsError(fetchError.message || "Unable to load bookings");
    } finally {
      setBookingsLoading(false);
    }
  };

  const fetchBookingDetails = async (booking) => {
    const token = localStorage.getItem("smartkerbToken");

    try {
      const response = await fetch(`${API_BASE}/api/admin/bookings/${booking.booking_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load booking details");
      setSelectedBooking(data);
    } catch (fetchError) {
      setBookingsError(fetchError.message || "Unable to load booking details");
    }
  };

  const fetchUsers = async () => {
    const token = localStorage.getItem("smartkerbToken");

    try {
      setUsersLoading(true);
      setUsersError("");
      const params = new URLSearchParams();
      if (userSearch.trim()) params.set("search", userSearch.trim());
      const response = await fetch(`${API_BASE}/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.message || "Unable to load users");
      setUsers(data);
    } catch (fetchError) {
      setUsersError(fetchError.message || "Unable to load users");
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchUserDetails = async (userItem) => {
    const token = localStorage.getItem("smartkerbToken");

    try {
      const response = await fetch(`${API_BASE}/api/admin/users/${userItem.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load user details");
      setSelectedUser(data);
    } catch (fetchError) {
      setUsersError(fetchError.message || "Unable to load user details");
    }
  };

  const fetchAnalytics = async () => {
    const token = localStorage.getItem("smartkerbToken");
    const range = getAnalyticsRange(analyticsPeriod, customStart, customEnd);

    if (!range.startDate || !range.endDate) return;

    try {
      setAnalyticsLoading(true);
      setAnalyticsError("");
      const params = new URLSearchParams(range);
      const response = await fetch(`${API_BASE}/api/admin/analytics?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load analytics");
      setAnalytics(data);
      setLastUpdated(new Date());
    } catch (fetchError) {
      setAnalyticsError(fetchError.message || "Unable to load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  useEffect(() => {
    fetchOperations();
    const interval = setInterval(fetchOperations, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeView === "locations" && locations.length === 0 && !locationsLoading) {
      fetchLocations();
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView === "bookings") fetchBookings();
    if (activeView === "users") fetchUsers();
  }, [activeView, bookingStatus, bookingDate, userSearch]);

  useEffect(() => {
    if (activeView === "analytics" && (analyticsPeriod !== "custom" || (customStart && customEnd))) {
      fetchAnalytics();
    }
  }, [activeView, analyticsPeriod, customStart, customEnd]);

  const displayName = user?.phone || "Administrator";
  const occupancy = Math.min(100, Math.max(0, Number(summary.utilization || 0)));
  const filteredLocations = locations.filter((location) => {
    const query = locationSearch.trim().toLowerCase();
    const matchesSearch =
      !query ||
      location.name.toLowerCase().includes(query) ||
      location.address.toLowerCase().includes(query);
    const matchesFilter =
      locationFilter === "All" ||
      (locationFilter === "Open" && location.locationStatus === "Open") ||
      (locationFilter === "Closed" && location.locationStatus === "Closed") ||
      (locationFilter === "Full" && location.status === "Full");

    return matchesSearch && matchesFilter;
  });

  const operationalLocations = operations?.locations || [];

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-icon">P</span>
          <span>SmartKerb</span>
        </div>

        <div className="admin-sidebar-heading">Management</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <button className={`admin-nav-item ${activeView === "dashboard" ? "active" : ""}`} type="button" onClick={() => setActiveView("dashboard")}>
            <span>⌂</span> Dashboard
          </button>
          <button className={`admin-nav-item ${activeView === "locations" ? "active" : ""}`} type="button" onClick={() => setActiveView("locations")}>
            <span>▦</span> Parking Locations
          </button>
          <button className={`admin-nav-item ${activeView === "bookings" ? "active" : ""}`} type="button" onClick={() => setActiveView("bookings")}>
            <span>◷</span> Bookings
          </button>
          <button className={`admin-nav-item ${activeView === "users" ? "active" : ""}`} type="button" onClick={() => setActiveView("users")}>
            <span>◉</span> Users
          </button>
          <button className={`admin-nav-item ${activeView === "analytics" ? "active" : ""}`} type="button" onClick={() => setActiveView("analytics")}>
            <span>⌁</span> Analytics
          </button>
        </nav>

        <button className="admin-sidebar-logout" type="button" onClick={onLogout}>
          <span>↪</span> Logout
        </button>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-kicker">SMART PARKING OPERATIONS</p>
            <h1>{activeView === "locations" ? "Parking locations" : activeView === "bookings" ? "Bookings" : activeView === "users" ? "Users" : activeView === "analytics" ? "Analytics" : "System overview"}</h1>
          </div>
          <div className="admin-profile">
            <div className="admin-avatar">A</div>
            <div>
              <strong>Admin</strong>
              <span>{displayName}</span>
            </div>
            <button className="admin-top-logout" type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </header>

        <section className="admin-content">
          {activeView === "locations" ? (
            <section className="locations-view">
              <div className="admin-section-intro">
                <div>
                  <p className="admin-kicker">NETWORK DIRECTORY</p>
                  <h2>Parking locations</h2>
                  <p>Keep capacity, pricing, and operating status accurate across the network.</p>
                </div>
                <button className="admin-refresh" type="button" onClick={() => openLocationModal()}>
                  Add location
                </button>
              </div>

              {locationsError && <div className="admin-error" role="alert">{locationsError}</div>}

              <div className="locations-toolbar">
                <input
                  className="locations-search"
                  type="search"
                  placeholder="Search by name or address"
                  value={locationSearch}
                  onChange={(event) => setLocationSearch(event.target.value)}
                />
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                  <option>All</option>
                  <option>Open</option>
                  <option>Full</option>
                  <option>Closed</option>
                </select>
                <button className="locations-refresh" type="button" onClick={fetchLocations} disabled={locationsLoading}>
                  {locationsLoading ? "Loading..." : "Refresh"}
                </button>
              </div>

              <div className="locations-table-wrap">
                {locationsLoading ? (
                  <div className="locations-empty">Loading parking locations...</div>
                ) : filteredLocations.length === 0 ? (
                  <div className="locations-empty">
                    <strong>{locations.length === 0 ? "No parking locations yet" : "No locations match these filters"}</strong>
                    <span>{locations.length === 0 ? "Add the first location to start managing the network." : "Try a different search or status."}</span>
                  </div>
                ) : (
                  <table className="locations-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Capacity</th>
                        <th>Price / hour</th>
                        <th>Status</th>
                        <th>Last updated</th>
                        <th><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLocations.map((location) => (
                        <tr key={location.id}>
                          <td><strong>{location.name}</strong><span>{location.address}</span></td>
                          <td><strong>{location.availableSpots}</strong> available<span>{location.occupiedSpots} occupied / {location.totalSpots} total</span></td>
                          <td>₹{location.pricePerHour.toLocaleString("en-IN")}</td>
                          <td><span className={`location-status location-status-${location.status.toLowerCase()}`}>{location.status}</span></td>
                          <td>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now"}</td>
                          <td className="location-actions">
                            <button type="button" onClick={() => openLocationModal(location)}>Edit</button>
                            <button type="button" onClick={() => requestLocationStatusChange(location)} disabled={locationActionId === location.id}>
                              {locationActionId === location.id ? "Saving..." : location.locationStatus === "Closed" ? "Reopen" : "Close"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : activeView === "bookings" ? (
            <section className="records-view">
              <div className="admin-section-intro">
                <div>
                  <p className="admin-kicker">RESERVATION MONITOR</p>
                  <h2>Bookings</h2>
                  <p>Review reservations and inspect their full details without rewriting history.</p>
                </div>
                <button className="admin-refresh" type="button" onClick={fetchBookings} disabled={bookingsLoading}>
                  {bookingsLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
              {bookingsError && <div className="admin-error" role="alert">{bookingsError}</div>}
              <div className="records-toolbar">
                <input className="records-search" type="search" placeholder="Search booking, user, or location" value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} />
                <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value)}><option>All</option><option>Active</option><option>Completed</option><option>Cancelled</option></select>
                <input type="date" value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} />
                <button className="locations-refresh" type="button" onClick={fetchBookings}>Search</button>
              </div>
              <div className="locations-table-wrap">
                {bookingsLoading ? <div className="locations-empty">Loading bookings...</div> : bookings.length === 0 ? <div className="locations-empty"><strong>No bookings found</strong><span>Try changing the filters.</span></div> : (
                  <table className="locations-table records-table">
                    <thead><tr><th>Booking</th><th>User</th><th>Location</th><th>Date and time</th><th>Amount</th><th>Status</th><th /></tr></thead>
                    <tbody>{bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td><strong>{booking.booking_id}</strong><span>{booking.duration} hour{Number(booking.duration) === 1 ? "" : "s"}</span></td>
                        <td>{booking.user_phone}</td>
                        <td>{booking.parking_name}</td>
                        <td><strong>{booking.booking_date}</strong><span>{booking.arrival_time} - {booking.end_time}</span></td>
                        <td>{formatCurrency(booking.total_price)}</td>
                        <td><span className={`booking-status booking-status-${booking.status.toLowerCase()}`}>{booking.status}</span></td>
                        <td><button className="record-link" type="button" onClick={() => fetchBookingDetails(booking)}>Details</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </section>
          ) : activeView === "users" ? (
            <section className="records-view">
              <div className="admin-section-intro">
                <div>
                  <p className="admin-kicker">CUSTOMER DIRECTORY</p>
                  <h2>Users</h2>
                  <p>Understand customer activity while keeping authentication data private.</p>
                </div>
                <button className="admin-refresh" type="button" onClick={fetchUsers} disabled={usersLoading}>{usersLoading ? "Loading..." : "Refresh"}</button>
              </div>
              {usersError && <div className="admin-error" role="alert">{usersError}</div>}
              <div className="records-toolbar"><input className="records-search" type="search" placeholder="Search by phone number" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} /><button className="locations-refresh" type="button" onClick={fetchUsers}>Search</button></div>
              <div className="locations-table-wrap">
                {usersLoading ? <div className="locations-empty">Loading users...</div> : users.length === 0 ? <div className="locations-empty"><strong>No users found</strong><span>Try a different search.</span></div> : (
                  <table className="locations-table records-table">
                    <thead><tr><th>User</th><th>Registration date</th><th>Total bookings</th><th>Active</th><th>Cancelled</th><th /></tr></thead>
                    <tbody>{users.map((userItem) => (
                      <tr key={userItem.id}>
                        <td><strong>{userItem.name}</strong><span>User ID {userItem.id}</span></td>
                        <td>{userItem.registrationDate ? new Date(userItem.registrationDate).toLocaleDateString("en-IN") : "Not available"}</td>
                        <td>{userItem.totalBookings}</td><td>{userItem.activeBookings}</td><td>{userItem.cancelledBookings}</td>
                        <td><button className="record-link" type="button" onClick={() => fetchUserDetails(userItem)}>View history</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </section>
          ) : activeView === "analytics" ? (
            <section className="analytics-view">
              <div className="admin-section-intro">
                <div>
                  <p className="admin-kicker">NETWORK INTELLIGENCE</p>
                  <h2>Parking analytics</h2>
                  <p>Understand demand, utilization, and revenue from recorded reservations.</p>
                </div>
                <button className="admin-refresh" type="button" onClick={fetchAnalytics} disabled={analyticsLoading}>
                  {analyticsLoading ? "Loading..." : "Refresh"}
                </button>
              </div>

              {analyticsError && <div className="admin-error" role="alert">{analyticsError}</div>}

              <div className="analytics-filters">
                <div className="analytics-segmented" role="group" aria-label="Analytics date range">
                  <button className={analyticsPeriod === "today" ? "selected" : ""} type="button" onClick={() => setAnalyticsPeriod("today")}>Today</button>
                  <button className={analyticsPeriod === "7" ? "selected" : ""} type="button" onClick={() => setAnalyticsPeriod("7")}>Last 7 days</button>
                  <button className={analyticsPeriod === "30" ? "selected" : ""} type="button" onClick={() => setAnalyticsPeriod("30")}>Last 30 days</button>
                  <button className={analyticsPeriod === "custom" ? "selected" : ""} type="button" onClick={() => setAnalyticsPeriod("custom")}>Custom</button>
                </div>
                {analyticsPeriod === "custom" && <div className="analytics-custom-range"><label>From<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>To<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
              </div>

              {!analytics && analyticsLoading ? <div className="analytics-loading">Calculating network insights...</div> : !analytics ? <AnalyticsEmpty message="Select a date range to view analytics" /> : (
                <>
                  <div className="analytics-total-grid">
                    <StatCard label="Bookings" value={analytics.totals.bookings} detail={`${analytics.range.startDate} to ${analytics.range.endDate}`} tone="green" />
                    <StatCard label="Revenue" value={formatCurrency(analytics.totals.revenue)} detail="Non-cancelled reservations" tone="gold" />
                    <StatCard label="Cancellations" value={analytics.totals.cancellations} detail="Recorded in this range" tone="cream" />
                  </div>

                  <div className="analytics-grid analytics-grid-main">
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">DEMAND</p><h3>Bookings over time</h3></div><span className="chart-legend chart-legend-green">Bookings</span></div><TrendChart trends={analytics.trends} valueKey="bookings" color="#3f7d4c" /></article>
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">EARNINGS</p><h3>Revenue over time</h3></div><span className="chart-legend chart-legend-gold">Revenue</span></div><TrendChart trends={analytics.trends} valueKey="revenue" color="#c29b50" currency /></article>
                  </div>

                  <div className="analytics-grid analytics-grid-secondary">
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">UTILIZATION</p><h3>By parking location</h3></div></div>{analytics.locations.length === 0 ? <AnalyticsEmpty /> : <div className="location-bars">{analytics.locations.map((location) => <div className="location-bar-row" key={location.id}><div><span>{location.name}</span><strong>{location.utilization}%</strong></div><div className="location-bar-track"><span style={{ width: `${location.utilization}%` }} /></div><small>{location.bookings} bookings · {formatCurrency(location.revenue)}</small></div>)}</div>}</article>
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">MIX</p><h3>Booking status</h3></div></div>{analytics.statuses.length === 0 ? <AnalyticsEmpty /> : <div className="status-chart">{analytics.statuses.map((item) => <div className="status-chart-row" key={item.status}><span className={`booking-status booking-status-${item.status.toLowerCase()}`}>{item.status}</span><div className="status-chart-track"><span style={{ width: `${(item.count / Math.max(analytics.totals.bookings, 1)) * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div>}</article>
                  </div>

                  <div className="analytics-grid analytics-grid-secondary">
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">DEMAND WINDOWS</p><h3>Peak parking periods</h3></div></div>{analytics.peakHours.length === 0 ? <AnalyticsEmpty /> : <div className="peak-hours">{analytics.peakHours.slice(0, 5).map((item) => <div key={item.hour}><span>{String(item.hour).padStart(2, "0")}:00</span><strong>{item.bookings} bookings</strong></div>)}</div>}</article>
                    <article className="admin-panel analytics-card"><div className="analytics-card-heading"><div><p className="admin-kicker">SIGNALS</p><h3>Supported insights</h3></div></div><div className="analytics-insights">{analytics.locations[0] && <p><strong>{analytics.locations[0].name}</strong> is the most used location by booking volume.</p>}{analytics.peakHours[0] && <p>Peak recorded demand is around <strong>{String(analytics.peakHours[0].hour).padStart(2, "0")}:00</strong>.</p>}{!analytics.locations[0] && !analytics.peakHours[0] && <AnalyticsEmpty message="Insights will appear when bookings are recorded" />}</div></article>
                  </div>
                </>
              )}
            </section>
          ) : (
          <>
          <div className="admin-section-intro">
            <div>
              <p className="admin-kicker">LIVE CONTROL ROOM</p>
              <h2>Parking network at a glance</h2>
              <p>Monitor capacity, demand, and today&apos;s activity from one place.</p>
            </div>
            <button className="admin-refresh" type="button" onClick={refreshDashboard} disabled={loading || operationsLoading}>
              {loading ? "Refreshing..." : "Refresh data"}
            </button>
          </div>

          {error && <div className="admin-error" role="alert">{error}</div>}

          <section className="admin-stat-grid" aria-label="Key performance indicators">
            <StatCard
              label="Parking locations"
              value={summary.totalParkingLocations}
              detail={`${summary.activeParkingLocations} currently active`}
              tone="green"
            />
            <StatCard
              label="Available spaces"
              value={summary.availableSpots}
              detail={`${summary.occupiedSpots} occupied right now`}
              tone="cream"
            />
            <StatCard
              label="Occupied spaces"
              value={summary.occupiedSpots}
              detail={`${occupancy.toFixed(1)}% network occupancy`}
              tone="gold"
            />
            <StatCard
              label="Today&apos;s bookings"
              value={summary.todayBookings}
              detail="All statuses included"
            />
            <StatCard
              label="Today&apos;s revenue"
              value={formatCurrency(summary.todayRevenue)}
              detail="Active and completed"
            />
          </section>

          <section className="admin-overview-grid">
            <article className="admin-panel occupancy-panel">
              <div className="admin-panel-heading">
                <div>
                  <p className="admin-kicker">NETWORK CAPACITY</p>
                  <h3>Overall occupancy</h3>
                </div>
                <strong className="occupancy-number">{occupancy.toFixed(1)}%</strong>
              </div>
              <div className="occupancy-track" aria-label={`${occupancy.toFixed(1)} percent occupied`}>
                <span style={{ width: `${occupancy}%` }} />
              </div>
              <div className="occupancy-footer">
                <span>{summary.occupiedSpots} occupied</span>
                <span>{summary.availableSpots} available</span>
              </div>
            </article>

            <article className="admin-panel status-panel">
              <div className="admin-panel-heading">
                <div>
                  <p className="admin-kicker">OPERATING STATUS</p>
                  <h3>Location health</h3>
                </div>
                <span className="status-live"><i /> Live</span>
              </div>
              <div className="status-list">
                <div><span><i className="status-dot status-open" />Active locations</span><strong>{summary.activeParkingLocations}</strong></div>
                <div><span><i className="status-dot status-closed" />Closed locations</span><strong>{summary.closedParkingLocations}</strong></div>
                <div><span><i className="status-dot status-occupied" />Total capacity</span><strong>{summary.availableSpots + summary.occupiedSpots}</strong></div>
              </div>
            </article>
          </section>

          <section className="operations-grid">
            <article className="admin-panel operations-panel">
              <div className="admin-panel-heading"><div><p className="admin-kicker">LIVE OPERATIONS</p><h3>Capacity watch</h3></div><span className="status-live"><i /> Auto-refresh</span></div>
              {operationsLoading && !operations ? <div className="operations-empty">Loading live capacity...</div> : operationalLocations.length === 0 ? <div className="operations-empty">No parking locations available.</div> : <div className="operations-location-list">{operationalLocations.map((location) => <div className="operations-location-row" key={location.id}><div><strong>{location.name}</strong><span>{location.occupied} occupied · {location.available} available</span></div><div className="operations-location-meta"><strong>{location.occupancy}%</strong><span className={`operation-badge operation-badge-${location.status.toLowerCase().replace(" ", "-")}`}>{location.status}</span></div></div>)}</div>}
            </article>
            <article className="admin-panel operations-panel">
              <div className="admin-panel-heading"><div><p className="admin-kicker">ATTENTION REQUIRED</p><h3>Alerts</h3></div><span className="alert-count">{operations?.alerts?.length || 0}</span></div>
              {!operations ? <div className="operations-empty">Waiting for operational data...</div> : operations.alerts.length === 0 ? <div className="operations-empty">All monitored conditions are normal.</div> : <div className="alert-list">{operations.alerts.map((alert, index) => <div className={`alert-item alert-item-${alert.type}`} key={`${alert.message}-${index}`}><span>{alert.type === "danger" ? "!" : "~"}</span><p>{alert.message}</p></div>)}</div>}
            </article>
          </section>

          {operationsError && <div className="admin-error" role="alert">{operationsError}</div>}

          <section className="admin-panel activity-panel">
            <div className="admin-panel-heading"><div><p className="admin-kicker">RECENT SYSTEM ACTIVITY</p><h3>Latest recorded events</h3></div><button className="locations-refresh" type="button" onClick={fetchOperations} disabled={operationsLoading}>{operationsLoading ? "Refreshing..." : "Refresh"}</button></div>
            {!operations ? <div className="operations-empty">Loading activity...</div> : operations.activities.length === 0 ? <div className="operations-empty">No recent system activity.</div> : <div className="activity-list">{operations.activities.map((activity) => <div className="activity-row" key={`${activity.id}-${activity.date}-${activity.time}`}><span className={`activity-icon activity-icon-${activity.type}`}>{activity.type === "cancelled" ? "×" : "+"}</span><div><strong>{activity.message}</strong><span>{activity.date} · {activity.time}</span></div></div>)}</div>}
          </section>

          <div className="admin-last-updated">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for live data"}
          </div>
          </>
          )}
        </section>
      </main>

      {selectedBooking && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedBooking(null)}>
          <div className="admin-modal detail-modal">
            <div className="admin-modal-heading"><div><p className="admin-kicker">BOOKING RECORD</p><h2>{selectedBooking.booking_id}</h2></div><button type="button" className="admin-modal-close" onClick={() => setSelectedBooking(null)} aria-label="Close">×</button></div>
            <div className="detail-grid">
              <div><span>User</span><strong>{selectedBooking.user_phone}</strong></div>
              <div><span>Location</span><strong>{selectedBooking.parking_name}</strong><small>{selectedBooking.parking_address}</small></div>
              <div><span>Date</span><strong>{selectedBooking.booking_date}</strong></div>
              <div><span>Time</span><strong>{selectedBooking.arrival_time} - {selectedBooking.end_time}</strong></div>
              <div><span>Duration</span><strong>{selectedBooking.duration} hour{Number(selectedBooking.duration) === 1 ? "" : "s"}</strong></div>
              <div><span>Amount</span><strong>{formatCurrency(selectedBooking.total_price)}</strong></div>
              <div><span>Status</span><strong>{selectedBooking.status}</strong></div>
            </div>
            <p className="detail-note">Historical booking data is read-only from the admin dashboard.</p>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedUser(null)}>
          <div className="admin-modal detail-modal">
            <div className="admin-modal-heading"><div><p className="admin-kicker">CUSTOMER PROFILE</p><h2>{selectedUser.name}</h2><p className="detail-subtitle">{selectedUser.phone}</p></div><button type="button" className="admin-modal-close" onClick={() => setSelectedUser(null)} aria-label="Close">×</button></div>
            <div className="user-detail-summary"><strong>{selectedUser.bookings.length}</strong><span>booking records</span></div>
            <div className="user-history-list">
              {selectedUser.bookings.length === 0 ? <div className="locations-empty">No booking history for this user.</div> : selectedUser.bookings.map((booking) => (
                <div key={booking.bookingId} className="user-history-row"><div><strong>{booking.parkingName}</strong><span>{booking.bookingDate} · {booking.arrivalTime} - {booking.endTime}</span></div><div><strong>{formatCurrency(booking.totalPrice)}</strong><span className={`booking-status booking-status-${booking.status.toLowerCase()}`}>{booking.status}</span></div></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmStatusChange && (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal confirm-modal">
            <div className="admin-modal-heading"><div><p className="admin-kicker">ADMIN ACTION</p><h2>{confirmStatusChange.nextStatus === "Closed" ? "Close parking location?" : "Reopen parking location?"}</h2></div><button type="button" className="admin-modal-close" onClick={() => setConfirmStatusChange(null)} aria-label="Close">×</button></div>
            <p className="confirm-copy">{confirmStatusChange.nextStatus === "Closed" ? "Drivers will no longer be able to reserve this location until it is reopened." : "This location will become available for new reservations again."}</p>
            <strong className="confirm-location">{confirmStatusChange.location.name}</strong>
            <div className="admin-modal-actions"><button type="button" className="locations-cancel" onClick={() => setConfirmStatusChange(null)}>Keep current status</button><button type="button" className="admin-refresh" onClick={() => changeLocationStatus(confirmStatusChange.location)} disabled={locationActionId === confirmStatusChange.location.id}>{locationActionId === confirmStatusChange.location.id ? "Saving..." : `Confirm ${confirmStatusChange.nextStatus === "Closed" ? "close" : "reopen"}`}</button></div>
          </div>
        </div>
      )}

      {locationModal && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setLocationModal(false)}>
          <form className="admin-modal" onSubmit={saveLocation}>
            <div className="admin-modal-heading">
              <div><p className="admin-kicker">LOCATION PROFILE</p><h2>{locationModal === "new" ? "Add location" : "Edit location"}</h2></div>
              <button type="button" className="admin-modal-close" onClick={() => setLocationModal(false)} aria-label="Close">×</button>
            </div>
            <div className="admin-form-grid">
              <label>Name<input required value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} /></label>
              <label>Address<input required value={locationForm.address} onChange={(event) => setLocationForm({ ...locationForm, address: event.target.value })} /></label>
              <label>Latitude<input required type="number" step="any" value={locationForm.latitude} onChange={(event) => setLocationForm({ ...locationForm, latitude: event.target.value })} /></label>
              <label>Longitude<input required type="number" step="any" value={locationForm.longitude} onChange={(event) => setLocationForm({ ...locationForm, longitude: event.target.value })} /></label>
              <label>Capacity<input required min="1" type="number" value={locationForm.capacity} onChange={(event) => setLocationForm({ ...locationForm, capacity: event.target.value })} /></label>
              <label>Price per hour<input required min="0" step="0.01" type="number" value={locationForm.pricePerHour} onChange={(event) => setLocationForm({ ...locationForm, pricePerHour: event.target.value })} /></label>
              <label>Status<select value={locationForm.status} onChange={(event) => setLocationForm({ ...locationForm, status: event.target.value })}><option>Open</option><option>Closed</option></select></label>
            </div>
            <div className="admin-modal-actions"><button type="button" className="locations-cancel" onClick={() => setLocationModal(false)}>Cancel</button><button type="submit" className="admin-refresh" disabled={locationSaving}>{locationSaving ? "Saving..." : "Save location"}</button></div>
          </form>
        </div>
      )}
      {toast && <div className="admin-toast" role="status" onAnimationEnd={() => setToast("")}>{toast}</div>}
    </div>
  );
}

export default AdminApp;
