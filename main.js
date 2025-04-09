// Enable path utilities
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Electron
import {
  app,
  Menu,
  Tray,
  shell,
  BrowserWindow,
  screen,
  ipcMain,
} from "electron";

// Node
import fs from "fs";
import { createCanvas } from "canvas";

// Equivalent to __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let data = {
  activeQuest: "",
  quests: [],
};

let tray = null;

// icpMain handlers
ipcMain.handle("quest:submit", (_event, questText) => {
  if (questText && questText.trim().length > 0) {
    data.quests.push({ title: questText.trim(), done: false });
    rebuildContextMenu();
    saveData();
  }
  if (promptWin) {
    promptWin.close();
    promptWin = null;
  }
});

ipcMain.handle("quest:cancel", () => {
  if (promptWin) {
    promptWin.close();
    promptWin = null;
  }
});

// This uses canvas to determine text size so we can fit it into a set width
function truncateTextToFit(text, baseMaxWidth = 40) {
  const {
    scaleFactor,
    size: { width: screenWidth },
  } = screen.getPrimaryDisplay();

  if (screenWidth > 1600) {
    baseMaxWidth += 65;
  }

  const effectiveMaxWidth = baseMaxWidth * scaleFactor;

  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext("2d");

  ctx.font = '14px "SF Pro Text", sans-serif';
  const textWidth = ctx.measureText(text).width;
  // console.log(
  //   `"${text}" is ${textWidth}px wide (max: ${effectiveMaxWidth}) @ scale ${scaleFactor} on screen ${screenWidth}px`
  // );

  if (textWidth <= effectiveMaxWidth) {
    return text;
  }

  let truncated = text;

  while (
    ctx.measureText(truncated + "…").width > effectiveMaxWidth &&
    truncated.length > 0
  ) {
    truncated = truncated.slice(0, -1);
  }

  return truncated.trim() + "…";
}

const dataDir = app.getPath("userData");
const dataFilePath = join(dataDir, "questbar-quests.json");
console.log(dataFilePath);

// Load from file
function loadData() {
  if (!fs.existsSync(dataFilePath)) {
    return { activeQuest: "", quests: [] };
  }
  try {
    const raw = fs.readFileSync(dataFilePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load file:", err);
    return { activeQuest: "", quests: [] };
  }
}

// Save to file
function saveData() {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save file:", err);
  }
}

// macOS menubar text = active quest
function updateTrayTitle() {
  tray.setToolTip(data.activeQuest);
  const safeTitle = truncateTextToFit(data.activeQuest);

  if (process.platform === "darwin") {
    if (!data.activeQuest) {
      tray.setTitle("", { fontType: "monospacedDigit" });
    } else {
      tray.setTitle(safeTitle, { fontType: "monospacedDigit" });
    }
  }
}

function setActiveTodo(title) {
  data.activeQuest = title;
  updateTrayTitle();

  rebuildContextMenu();
  saveData();
}

function toggleTodoDone(index) {
  // Toggle the done state first
  data.quests[index].done = !data.quests[index].done;

  // If the item is now marked as done and is the active quest, clear it
  if (
    data.quests[index].done &&
    data.quests[index].title === data.activeQuest
  ) {
    data.activeQuest = "";
  }

  rebuildContextMenu();
  saveData();
}

// ADD NEW QUEST

let promptWin = null; // keep this at the top level (outside the function)

function showQuestPrompt() {
  if (promptWin && !promptWin.isDestroyed()) {
    promptWin.focus();
    return;
  }

  const { x, y, width: trayWidth, height: trayHeight } = tray.getBounds();
  const screenBounds = screen.getPrimaryDisplay().bounds;

  const promptWidth = 400;
  const promptHeight = 180;

  promptWin = new BrowserWindow({
    width: promptWidth,
    height: promptHeight,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    show: false,
    title: "Add New Quest",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  // Position logic
  let posX = Math.round(x + trayWidth / 2 - promptWidth / 2);
  const posY =
    process.platform === "darwin" ? y + trayHeight + 6 : y + trayHeight;

  if (posX + promptWidth > screenBounds.width) {
    posX = screenBounds.width - promptWidth - 10;
  }
  if (posX < 0) {
    posX = 10;
  }

  promptWin.setPosition(posX, posY);
  promptWin.loadFile("prompt.html");
  promptWin.setOpacity(0);
  promptWin.show();

  // Close the prompt when user clicks outside — but ignore if dev tools are open
  const handlePromptBlur = () => {
    if (
      promptWin &&
      !promptWin.webContents.isDevToolsOpened() &&
      !promptWin.isDestroyed()
    ) {
      promptWin.close();
      promptWin = null;
    }
  };

  // Delay blur listening to avoid auto-close during first focus
  setTimeout(() => {
    if (promptWin) {
      promptWin.on("blur", handlePromptBlur);
    }
  }, 100);

  let opacity = 0;
  const interval = setInterval(() => {
    opacity += 0.1;
    if (opacity >= 1) {
      clearInterval(interval);
      promptWin.setOpacity(1);
    } else {
      promptWin.setOpacity(opacity);
    }
  }, 16);
}

// Build the tray menu
function buildContextMenu() {
  const active = data.quests.find((quest) => quest.title === data.activeQuest);
  const incompleteQuests = data.quests.filter(
    (quest) => !quest.done && quest.title !== data.activeQuest
  );
  const completedQuests = data.quests.filter((quest) => quest.done);

  const activeSection = active
    ? [
        {
          label: `★ ${active.title}`,
          submenu: [
            {
              label: "Vanquish",
              click: () => {
                active.done = true;
                data.activeQuest = "";
                rebuildContextMenu();
                saveData();
              },
            },
            {
              label: "Stop Quest",
              click: () => {
                data.activeQuest = "";
                rebuildContextMenu();
                saveData();
              },
            },
          ],
        },
        { type: "separator" },
      ]
    : [];

  const openQuests = incompleteQuests.map((quest, index) => ({
    label: quest.title,
    submenu: [
      {
        label: "Start Quest",
        click: () => setActiveTodo(quest.title),
      },
      {
        label: "Vanquish",
        click: () => toggleTodoDone(data.quests.indexOf(quest)),
      },
    ],
  }));

  const doneQuests = completedQuests.map((quest) => ({
    label: `✓ ${quest.title}`,
    submenu: [
      {
        label: "Resurrect",
        click: () => toggleTodoDone(data.quests.indexOf(quest)),
      },
    ],
  }));

  const template = [
    {
      label: "Add New Quest",
      click: () => showQuestPrompt(),
    },
    { type: "separator" },
    ...activeSection,
    ...openQuests,
    openQuests.length && doneQuests.length ? { type: "separator" } : null,
    ...doneQuests,
    { type: "separator" },

    {
      label: "QuestFile",
      submenu: [
        {
          label: "Open QuestFile",

          click: () => {
            shell.openPath(dataFilePath);
          },
        },
        {
          label: "Reload QuestFile",
          click: () => {
            data = loadData();
            rebuildContextMenu();
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "Quit",
      role: "quit",
    },
  ].filter(Boolean); // removes null entries

  return Menu.buildFromTemplate(template);
}

function rebuildContextMenu() {
  const menu = buildContextMenu();
  tray.setContextMenu(menu);
  updateTrayTitle();
}

// Create the menubar/tray
function createTray() {
  // Provide a real image file here.
  tray = new Tray(join(__dirname, "iconTemplate@2x.png"));
  tray.setToolTip("QuestBar");
  rebuildContextMenu();
}

// Main
app.whenReady().then(() => {
  // Load data from file at startup
  data = loadData();

  createTray();

  // Hide Dock icon on macOS
  if (process.platform === "darwin") {
    app.dock.hide();
  }
});

// Prevent the app from quitting if all windows close
app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("activate", () => {
  if (tray === null) {
    createTray();
  }
});
