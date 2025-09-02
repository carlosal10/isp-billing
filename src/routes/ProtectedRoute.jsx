// src/routes/ProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthed } = useAuth();
  const location = useLocation();
  return isAuthed ? <Outlet /> : <Navigate to="/login" replace state={{ from: location }} />;
}
