import { Key } from "@nut-tree-fork/nut-js";
import cv from "@u4/opencv4nodejs";

export function mapLanguageToCode(language, fallback = "en") {
  const languages = [
    { language: "English", code: "en" },
    { language: "Spanish", code: "es" },
    { language: "French", code: "fr" },
    { language: "German", code: "de" },
    { language: "Italian", code: "it" },
    { language: "Portuguese", code: "pt" },
    { language: "Polish", code: "pl" },
    { language: "Turkish", code: "tr" },
    { language: "Russian", code: "ru" },
    { language: "Dutch", code: "nl" },
    { language: "Czech", code: "cs" },
    { language: "Arabic", code: "ar" },
    { language: "Chinese", code: "zh-cn" },
    { language: "Japanese", code: "ja" },
    { language: "Hungarian", code: "hu" },
    { language: "Korean", code: "ko" },
    { language: "Hindi", code: "hi" },
  ];

  return (
    languages.find((l) => l.language.toLowerCase() === language.toLowerCase())
      ?.code || fallback
  );
}

export function mapGlobalKeyToNutKey(globalKey) {
  const keyMapping = {
    // Alphanumeric keys
    A: Key.A,
    B: Key.B,
    C: Key.C,
    D: Key.D,
    E: Key.E,
    F: Key.F,
    G: Key.G,
    H: Key.H,
    I: Key.I,
    J: Key.J,
    K: Key.K,
    L: Key.L,
    M: Key.M,
    N: Key.N,
    O: Key.O,
    P: Key.P,
    Q: Key.Q,
    R: Key.R,
    S: Key.S,
    T: Key.T,
    U: Key.U,
    V: Key.V,
    W: Key.W,
    X: Key.X,
    Y: Key.Y,
    Z: Key.Z,
    0: Key.D0,
    1: Key.D1,
    2: Key.D2,
    3: Key.D3,
    4: Key.D4,
    5: Key.D5,
    6: Key.D6,
    7: Key.D7,
    8: Key.D8,
    9: Key.D9,

    // Arrow keys
    "UP ARROW": Key.Up,
    "DOWN ARROW": Key.Down,
    "LEFT ARROW": Key.Left,
    "RIGHT ARROW": Key.Right,

    // Numpad keys
    "NUMPAD 0": Key.Num0,
    "NUMPAD 1": Key.Num1,
    "NUMPAD 2": Key.Num2,
    "NUMPAD 3": Key.Num3,
    "NUMPAD 4": Key.Num4,
    "NUMPAD 5": Key.Num5,
    "NUMPAD 6": Key.Num6,
    "NUMPAD 7": Key.Num7,
    "NUMPAD 8": Key.Num8,
    "NUMPAD 9": Key.Num9,
    "NUMPAD EQUALS": Key.NumEqual,
    "NUMPAD DIVIDE": Key.NumDivide,
    "NUMPAD MULTIPLY": Key.NumMultiply,
    "NUMPAD MINUS": Key.NumSubtract,
    "NUMPAD PLUS": Key.NumAdd,
    "NUMPAD RETURN": Key.NumEnter,
    "NUMPAD DOT": Key.NumDecimal,

    // Modifier keys
    WIN: Key.LeftWin,
    "LEFT META": Key.LeftSuper,
    "RIGHT META": Key.RightSuper,
    "LEFT CTRL": Key.LeftControl,
    "RIGHT CTRL": Key.RightControl,
    "LEFT ALT": Key.LeftAlt,
    "RIGHT ALT": Key.RightAlt,
    "LEFT SHIFT": Key.LeftShift,
    "RIGHT SHIFT": Key.RightShift,
    "CAPS LOCK": Key.CapsLock,
    "NUM LOCK": Key.NumLock,
    "SCROLL LOCK": Key.ScrollLock,

    // Function keys
    F1: Key.F1,
    F2: Key.F2,
    F3: Key.F3,
    F4: Key.F4,
    F5: Key.F5,
    F6: Key.F6,
    F7: Key.F7,
    F8: Key.F8,
    F9: Key.F9,
    F10: Key.F10,
    F11: Key.F11,
    F12: Key.F12,
    F13: Key.F13,
    F14: Key.F14,
    F15: Key.F15,
    F16: Key.F16,
    F17: Key.F17,
    F18: Key.F18,
    F19: Key.F19,
    F20: Key.F20,
    F21: Key.F21,
    F22: Key.F22,
    F23: Key.F23,
    F24: Key.F24,

    // Symbol keys
    EQUALS: Key.Equal,
    MINUS: Key.Minus,
    "SQUARE BRACKET OPEN": Key.LeftBracket,
    "SQUARE BRACKET CLOSE": Key.RightBracket,
    SEMICOLON: Key.Semicolon,
    QUOTE: Key.Quote,
    BACKSLASH: Key.Backslash,
    COMMA: Key.Comma,
    DOT: Key.Period,
    "FORWARD SLASH": Key.Slash,

    // Buttons
    ENTER: Key.Return,
    SPACE: Key.Space,
    BACKSPACE: Key.Backspace,
    RETURN: Key.Return,
    ESCAPE: Key.Escape,
    BACKTICK: Key.Backquote,
    DELETE: Key.Delete,
    TAB: Key.Tab,

    // Scroll keys
    "PAGE UP": Key.PageUp,
    "PAGE DOWN": Key.PageDown,
    HOME: Key.Home,
    END: Key.End,

    // Rare use keys
    INS: Key.Insert,
    "NUMPAD CLEAR": Key.Clear,
    "PRINT SCREEN": Key.Print,

    // Mouse buttons (not directly supported by nut.js for keypresses, ignore these)
    "MOUSE LEFT": null,
    "MOUSE RIGHT": null,
    "MOUSE MIDDLE": null,
    "MOUSE X1": null,
    "MOUSE X2": null,

    // Undefined
    "": null,
  };

  return keyMapping[globalKey] || null;
}

export function map(x, in_min, in_max, out_min, out_max) {
  return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
}

export function mapXToScreen(x, resolutionWidth, screenWidth) {
  return map(x, 0, resolutionWidth, 0, screenWidth);
}

export function mapYToScreen(y, resolutionHeight, screenHeight) {
  return map(y, 0, resolutionHeight, 0, screenHeight);
}

// Function to generate a color from a string (class name)
export function generateColorFromString(str) {
  // Hash the class name string to create a unique color
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Map the hash to RGB values (0-255)
  const r = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const b = hash & 0x0000ff;

  // Return a string that represents the color in RGB format
  return `rgb(${r}, ${g}, ${b})`;
}

export function generateColorFromStringCV(str) {
  // Hash the class name string to create a unique color
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Map the hash to RGB values (0-255)
  const b = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const r = hash & 0x0000ff;

  // Return a cv.Vec format color (BGR order for OpenCV)
  return new cv.Vec(b, g, r);
}

export default {
  mapGlobalKeyToNutKey,
  mapXToScreen,
  mapYToScreen,
};
