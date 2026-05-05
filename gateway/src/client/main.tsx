import React from "react";
import { createRoot } from "react-dom/client";
import { GatewayApp } from "./GatewayApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GatewayApp />
  </React.StrictMode>
);
