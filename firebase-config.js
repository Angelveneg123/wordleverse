// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Configuración Firebase
const firebaseConfig = {

  apiKey: "AIzaSyBxAFT4oyVR4W1cAOC9MGSd3fpTQbjY-Ug",

  authDomain: "wordleonline-a2960.firebaseapp.com",

  // ESTA ES LA URL CORRECTA
  databaseURL:
    "https://wordleonline-a2960-default-rtdb.firebaseio.com/",

  projectId: "wordleonline-a2960",

  storageBucket:
    "wordleonline-a2960.firebasestorage.app",

  messagingSenderId: "782789050087",

  appId:
    "1:782789050087:web:83d763c76202d4c3beec42"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Realtime Database
const db = getDatabase(app);

// Exportar
export { db };