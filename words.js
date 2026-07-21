// words.js — Bancos de palabras por tema y longitud

// Todas las palabras van en MAYÚSCULAS y sin tildes/ñ para simplificar el input.


export const THEMES = {
  deportes: { label: "Deportes", icon: "⚽" },
  peliculas: { label: "Películas", icon: "🎬" },
  memes: { label: "Memes", icon: "😂" },
  animales: { label: "Animales", icon: "🐾" },
  comida: { label: "Comida", icon: "🍔" },
  aleatorio: { label: "Aleatorio", icon: "🎲" }
};

export const DIFFICULTIES = {
  facil:  { label: "Fácil",   icon: "🟢", lengths: [5] },
  normal: { label: "Normal",  icon: "🟡", lengths: [5, 6, 7] },
  dificil:{ label: "Difícil", icon: "🔴", lengths: [7, 8, 9, 10] }
};

export const MODES = {
  clasico: { label: "Clásico", description: "Adivina la palabra. Como el Wordle de siempre.", enabled: true },
  contrarreloj: { label: "Contrarreloj", description: "Cada ronda tiene un límite de tiempo. Si se acaba, se revela la palabra.", enabled: true },
  eliminacion: { label: "Eliminación", description: "Si no ganas la ronda, quedas eliminado. Al estilo Fall Guys.", enabled: true },
  supervivencia: { label: "Supervivencia", description: "No puedes fallar ninguna palabra.", enabled: false },
  todos_contra_todos: { label: "Todos contra todos", description: "Gana quien acierte primero.", enabled: false },
  cooperativo: { label: "Cooperativo", description: "Todos los jugadores se ayudan entre sí.", enabled: false },
  relevos: { label: "Relevos", description: "Cada jugador hace un intento por turno.", enabled: false },
  boss: { label: "Boss", description: "Una palabra enorme para todos juntos.", enabled: false },
  duelo: { label: "Duelo", description: "1 contra 1.", enabled: false },
  torneo: { label: "Torneo", description: "16 jugadores. Eliminación por llaves.", enabled: false },
};

const THEME_WORDS = {
  deportes: {
    5: ["BALON", "BOXEO", "CASCO", "CESTA", "FINAL", "GOLES", "PATIN", "PENAL", "PESAS", "PISTA", "SAQUE", "TENIS", "VOLEY"],
    6: ["CANCHA", "EQUIPO", "FUTBOL", "PELOTA", "TORNEO"],
    7: ["ARBITRO", "ARQUERO", "CAMPEON", "CUARTOS", "DEFENSA", "ESTADIO", "MARATON", "MEDALLA", "MUSCULO", "PATINES", "PENALTI", "PORTERO", "RAQUETA", "SILBATO", "TARJETA"],
    8: ["CICLISMO", "DEPORTES", "ENTRENAR", "GIMNASIA", "JUGADORA", "NATACION"],
    9: ["ATLETISMO", "CAMPEONES", "DELANTERO", "JUGADORES", "SEMIFINAL", "VELOCIDAD"],
    10: ["BALONCESTO", "BASQUETBOL", "CRONOMETRO", "ENTRENADOR"],
  },
  peliculas: {
    5: ["ACTOR", "DRAMA", "GUION", "HEROE", "OSCAR", "TRAMA"],
    6: ["ACCION", "ACTRIZ", "BIOPIC", "CAMARA", "ESCENA", "PREMIO", "RESENA", "RODAJE", "TERROR"],
    7: ["ANIMADO", "BOLETOS", "CIENCIA", "COMEDIA", "CRITICA", "DOBLAJE", "ENTRADA", "ESTRENO", "ESTUDIO", "FICCION", "HEROINA", "MUSICAL", "REPARTO", "ROMANCE", "SECUELA", "VILLANO"],
    8: ["DIRECTOR", "FANTASIA", "PANTALLA", "PRECUELA", "SUSPENSO", "TAQUILLA", "THRILLER", "TRILOGIA"],
    9: ["ANIMACION", "CARTELERA", "GUIONISTA", "HOLLYWOOD", "PALOMITAS", "PERSONAJE", "PRODUCTOR"],
    10: ["DOCUMENTAL", "SUBTITULOS"],
  },
  memes: {
    5: ["BROMA", "EMOJI", "LIKES", "REDES", "REELS", "REMIX", "TREND", "TROLL", "VIDEO", "VIRAL"],
    6: ["CAMARA", "CHISTE", "CRINGE", "EMOJIS", "FILTRO", "PERFIL", "SELFIE", "TIKTOK", "VIDEOS"],
    7: ["CREADOR", "DESAFIO", "EDICION", "FILTROS", "HASHTAG", "PARODIA", "SELFIES", "STICKER", "TROLEAR", "USUARIO"],
    8: ["GRACIOSO", "HISTORIA", "REACCION", "SEGUIDOR", "STREAMER"],
    9: ["ALGORITMO", "CHALLENGE", "COMPARTIR", "CONTENIDO", "HISTORIAS", "TENDENCIA"],
    10: ["COMENTARIO", "COMPARTIDO", "INFLUENCER", "PLATAFORMA", "REACCIONES", "SEGUIDORES", "TENDENCIAS"],
  },
  animales: {
    5: ["ABEJA", "ARANA", "CABRA", "CEBRA", "CERDO", "ERIZO", "GALLO", "KOALA", "OVEJA", "PANDA", "PERRO", "PULPO", "RATON", "TIGRE", "ZORRO"],
    6: ["AGUILA", "CONEJO", "CUERVO", "DELFIN", "GORILA", "HALCON", "IGUANA", "JIRAFA", "PALOMA"],
    7: ["ARDILLA", "BALLENA", "CABALLO", "CANGURO", "COLIBRI", "GALLINA", "HORMIGA", "LAGARTO", "TIBURON", "TORTUGA"],
    8: ["CAMALEON", "CANGREJO", "ELEFANTE", "MARIPOSA", "PINGUINO", "ZORRILLO"],
    9: ["COCODRILO", "ESCORPION", "SERPIENTE"],
    10: ["HIPOPOTAMO", "MURCIELAGO"],
  },
  comida: {
    5: ["ARROZ", "CARNE", "DULCE", "FRESA", "FRUTA", "HUEVO", "LECHE", "LIMON", "MANGO", "MELON", "PANES", "PAPAS", "PASTA", "PIZZA", "PLATO", "POLLO", "QUESO", "TACOS", "TORTA"],
    6: ["ACEITE", "AZUCAR", "BEBIDA", "COCINA", "DULCES", "FRESAS", "FRIJOL", "FRUTAS", "HELADO", "HUEVOS", "PASTEL", "POSTRE", "RECETA", "SANDIA", "TOMATE"],
    7: ["CEBOLLA", "COCINAR", "CUCHARA", "GALLETA", "LECHUGA", "MANZANA", "NARANJA", "PESCADO", "PLATANO", "TENEDOR"],
    8: ["ALMUERZO", "CUCHILLO", "DESAYUNO", "ENSALADA", "FRIJOLES", "GALLETAS", "REFRESCO"],
    9: ["CHOCOLATE", "ZANAHORIA"],
    10: ["REFRIGERIO", "CHOCOLATES"],
  },
};


// Pool general (unión de todos los temas) — usado por "Aleatorio"
// y como respaldo cuando a un tema le faltan palabras de cierta longitud.
const GENERAL_WORDS = {};
for (let n = 5; n <= 10; n++) {
  const set = new Set();
  Object.values(THEME_WORDS).forEach(theme => {
    (theme[n] || []).forEach(w => set.add(w));
  });
  GENERAL_WORDS[n] = Array.from(set);
}

function pickFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Elige una longitud válida según la dificultad
export function pickLength(difficultyKey) {
  const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
  return pickFrom(diff.lengths);
}

// Devuelve { word, length } para una sala según su tema y dificultad
export function getWordForRoom(themeKey, difficultyKey) {
  const length = pickLength(difficultyKey);

  let pool;

  if (!themeKey || themeKey === "aleatorio" || !THEME_WORDS[themeKey]) {
    pool = GENERAL_WORDS[length];
  } else {
    pool = THEME_WORDS[themeKey][length];

    // Si el tema no tiene palabras de esa longitud, usamos el pool general
    if (!pool || pool.length === 0) {
      pool = GENERAL_WORDS[length];
    }
  }

  if (!pool || pool.length === 0) {
    // Último respaldo: cualquier longitud del pool general
    const fallbackLength = [5, 6, 7, 8, 9, 10].find(n => GENERAL_WORDS[n].length > 0);
    pool = GENERAL_WORDS[fallbackLength];
  }

  return { word: pickFrom(pool), length: pool === GENERAL_WORDS[length] ? length : length };
}

// Mantener compatibilidad con código viejo que usaba getRandomWord()
export function getRandomWord() {
  return getWordForRoom("aleatorio", "facil").word;
}