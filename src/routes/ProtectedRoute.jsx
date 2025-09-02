// src/routes/ProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthed } = useAuth();               // <- use the actual key
  const location = useLocation();

  // Optional: small boot gate if you add one later
  // const { booting } = useAuth();
  // if (booting) return null; // or a spinner

  return isAuthed
    ? <Outlet />
    : <Navigate to="/login" replace state={{ from: location }} />;
}
