import React from "react";

export function Button({ children, onClick, type = "button", className = "" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`px-4 py-2 bg-blue-600 text-white rounded-xl shadow hover:bg-blue-700 transition ${className}`}
    >
      {children}
    </button>
  );
}
