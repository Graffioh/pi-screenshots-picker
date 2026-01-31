/**
 * Screenshots Extension
 *
 * Shows recent screenshots in a panel for quick selection and attachment.
 * Works on macOS and Linux. Much faster than dragging files - just select and stage!
 *
 * Features:
 * - Shows all recent screenshots with scrollable list
 * - Displays relative timestamps (e.g., "2 minutes ago")
 * - Shows thumbnail preview of selected screenshot
 * - Press 'o' to open in default image viewer
 * - Stage multiple screenshots with s/space (✓ indicator)
 * - Shows widget indicator when screenshots are staged
 * - Type your message after staging, images attach on send
 *
 * Usage:
 *   /ss              - Show screenshot selector (stages images)
 *   /ssclear         - Clear staged screenshots
 *   Ctrl+Shift+S     - Quick access shortcut
 *
 * Keys:
 *   ↑↓               - Navigate
 *   s / space        - Stage current screenshot (can repeat on different items)
 *   o                - Open in default viewer
 *   d                - Delete screenshot from disk
 *   enter            - Close selector
 *   esc              - Cancel
 *
 * Workflow:
 *   1. Press Ctrl+Shift+S or /ss to open selector
 *   2. Navigate with ↑↓, press s/space to stage screenshots (✓ appears)
 *   3. Press Enter to close selector
 *   4. Type your message in the prompt
 *   5. Press Enter to send - staged images are automatically attached
 *
 * Configuration (optional):
 *   Set screenshot directory in ~/.pi/agent/extensions/screenshots.json:
 *   { "directory": "/path/to/screenshots" }
 *
 *   Or use PI_SCREENSHOTS_DIR environment variable.
 *
 * Default screenshot locations:
 *   macOS: reads from screencapture preferences, falls back to ~/Desktop
 *   Linux: ~/Pictures/Screenshots, ~/Pictures, ~/Screenshots, or ~/Desktop
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ImageContent } from "@mariozechner/pi-coding-agent";
import { Image, Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";

interface ScreenshotInfo {
	path: string;
	name: string;
	mtime: Date;
	size: number;
}

interface Config {
	directory?: string;
}

const SCREENSHOT_PATTERNS = [
	// macOS patterns
	/^Screenshot\s/i, // English: "Screenshot 2024-01-30..."
	/^Capture\s/i, // French: "Capture d'écran..."
	/^Scherm/i, // Dutch: "Schermafbeelding..."
	/^Bildschirmfoto/i, // German
	/^Captura\s/i, // Spanish
	/^Istantanea/i, // Italian
	// Linux patterns (various screenshot tools)
	/^screenshot/i, // Generic
	/^\d{4}-\d{2}-\d{2}[_-]\d{2}[_-]\d{2}/i, // GNOME: "2024-01-30_12-30-45.png"
	/^flameshot/i, // Flameshot
	/^spectacle/i, // KDE Spectacle
	/^scrot/i, // Scrot
	/^maim/i, // Maim
	/^grim/i, // Grim (Wayland)
];

/**
 * Detect the platform.
 */
const isMacOS = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * Get the default screenshot directory based on platform.
 */
function getDefaultScreenshotDir(): string {
	if (isMacOS) {
		// Try to read macOS screenshot preferences
		try {
			const result = execSync("defaults read com.apple.screencapture location 2>/dev/null", {
				encoding: "utf-8",
			}).trim();
			if (result && existsSync(result)) {
				return result;
			}
		} catch {
			// Ignore errors, use fallback
		}
		return join(homedir(), "Desktop");
	}

	if (isLinux) {
		// Common Linux screenshot directories
		const linuxDirs = [
			join(homedir(), "Pictures", "Screenshots"),
			join(homedir(), "Pictures"),
			join(homedir(), "Screenshots"),
			join(homedir(), "Desktop"),
		];
		for (const dir of linuxDirs) {
			if (existsSync(dir)) {
				return dir;
			}
		}
	}

	// Fallback for any platform
	return join(homedir(), "Desktop");
}

/**
 * Open a file with the default system viewer.
 */
function openFile(path: string): void {
	try {
		if (isMacOS) {
			execSync(`open "${path}"`);
		} else if (isLinux) {
			execSync(`xdg-open "${path}" &`);
		}
	} catch {
		// Ignore errors
	}
}

/**
 * Load extension config.
 */
function loadConfig(): Config {
	const configPath = join(homedir(), ".pi", "agent", "extensions", "screenshots.json");
	if (existsSync(configPath)) {
		try {
			return JSON.parse(readFileSync(configPath, "utf-8"));
		} catch {
			// Ignore parse errors
		}
	}
	return {};
}

/**
 * Check if a filename looks like a screenshot.
 */
function isScreenshotName(name: string): boolean {
	return SCREENSHOT_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Get all screenshots from directory, sorted by name (descending).
 */
function getScreenshots(directory: string): ScreenshotInfo[] {
	if (!existsSync(directory)) {
		return [];
	}

	const files = readdirSync(directory)
		.filter((name) => {
			// Must be PNG (screenshots are PNG by default)
			if (!name.toLowerCase().endsWith(".png")) return false;
			// Must match screenshot naming pattern
			return isScreenshotName(name);
		})
		.map((name) => {
			const path = join(directory, name);
			const stats = statSync(path);
			return {
				path,
				name,
				mtime: stats.mtime,
				size: stats.size,
			};
		})
		// Sort by filename descending (more reliable than mtime for screenshots)
		.sort((a, b) => b.name.localeCompare(a.name));

	return files;
}

/**
 * Format relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const diff = now - date.getTime();

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return days === 1 ? "yesterday" : `${days} days ago`;
	if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	if (minutes > 0) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	return "just now";
}

/**
 * Format file size.
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Load image as base64.
 */
function loadImageBase64(path: string): { data: string; mimeType: string } {
	const buffer = readFileSync(path);
	return {
		data: buffer.toString("base64"),
		mimeType: "image/png",
	};
}

export default function screenshotsExtension(pi: ExtensionAPI) {
	const config = loadConfig();

	// Staged images waiting to be sent with the next user message
	let stagedImages: ImageContent[] = [];

	/**
	 * Get screenshot directory (config > env > macOS prefs > Desktop).
	 */
	function getScreenshotDir(): string {
		if (config.directory && existsSync(config.directory)) {
			return config.directory;
		}
		const envDir = process.env.PI_SCREENSHOTS_DIR;
		if (envDir && existsSync(envDir)) {
			return envDir;
		}
		return getDefaultScreenshotDir();
	}

	// Intercept input events to attach staged images
	pi.on("input", (event, ctx) => {
		if (stagedImages.length === 0) {
			return { action: "continue" as const };
		}

		// Attach staged images to the user's message
		const imagesToAttach = [...stagedImages];
		stagedImages = []; // Clear staged images
		
		// Clear the widget
		ctx.ui.setWidget("screenshots-staged", undefined);

		return {
			action: "transform" as const,
			text: event.text,
			images: [...(event.images || []), ...imagesToAttach],
		};
	});

	// Helper to get PNG dimensions
	function getPngDimensions(base64Data: string): { width: number; height: number } | null {
		try {
			const buffer = Buffer.from(base64Data, "base64");
			if (buffer.length < 24) return null;
			if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null;
			return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
		} catch {
			return null;
		}
	}

	/**
	 * Show screenshot selector UI.
	 */
	async function showScreenshotSelector(ctx: ExtensionContext): Promise<void> {
		const directory = getScreenshotDir();
		let screenshots = getScreenshots(directory);

		if (screenshots.length === 0) {
			ctx.ui.notify(`No screenshots found in ${directory}`, "warning");
			return;
		}

		// Lazy-load thumbnails (load on demand, skip files > 5MB)
		const MAX_THUMB_SIZE = 5 * 1024 * 1024; // 5MB
		const thumbnails: Map<number, { data: string; mimeType: string } | null> = new Map();
		
		function loadThumbnail(index: number): { data: string; mimeType: string } | null {
			if (thumbnails.has(index)) {
				return thumbnails.get(index) || null;
			}
			const screenshot = screenshots[index];
			if (!screenshot || screenshot.size > MAX_THUMB_SIZE) {
				thumbnails.set(index, null);
				return null;
			}
			try {
				const img = loadImageBase64(screenshot.path);
				thumbnails.set(index, img);
				return img;
			} catch {
				thumbnails.set(index, null);
				return null;
			}
		}

		// Track which screenshots have been staged during this session
		const alreadyStaged = new Set<number>();

		const result = await ctx.ui.custom<string[] | null>((tui, theme, _kb, done) => {
			let cursor = 0;
			let scrollOffset = 0;
			const LIST_WIDTH = 45;
			const VISIBLE_ITEMS = 12;
			const CONTENT_LINES = 12;

			const imageTheme = {
				fallbackColor: (s: string) => theme.fg("dim", s),
			};

			// Helper to stage a single screenshot immediately
			function stageScreenshot(index: number): void {
				if (alreadyStaged.has(index)) return; // Already staged this one
				
				const screenshot = screenshots[index];
				if (!screenshot) return;

				try {
					const img = loadImageBase64(screenshot.path);
					stagedImages.push({
						type: "image",
						mimeType: img.mimeType,
						data: img.data,
					});
					alreadyStaged.add(index);
				} catch {
					// Silently fail for individual staging
				}
			}

			// Typical terminal cell dimensions (pixels)
			const CELL_WIDTH_PX = 9;
			const CELL_HEIGHT_PX = 18;
			const MAX_WIDTH_CELLS = 45;

			// Calculate max width cells so that image height fits in maxRows
			function calculateConstrainedWidth(dims: { width: number; height: number }, maxRows: number): number {
				const scaledWidthPx = MAX_WIDTH_CELLS * CELL_WIDTH_PX;
				const scale = scaledWidthPx / dims.width;
				const scaledHeightPx = dims.height * scale;
				const rows = Math.ceil(scaledHeightPx / CELL_HEIGHT_PX);

				if (rows <= maxRows) {
					return MAX_WIDTH_CELLS;
				}

				const targetHeightPx = maxRows * CELL_HEIGHT_PX;
				const targetScale = targetHeightPx / dims.height;
				const targetWidthPx = dims.width * targetScale;
				return Math.max(1, Math.floor(targetWidthPx / CELL_WIDTH_PX));
			}

			function padToWidth(str: string, targetWidth: number): string {
				const currentWidth = visibleWidth(str);
				if (currentWidth >= targetWidth) return str;
				return str + " ".repeat(targetWidth - currentWidth);
			}

			let lastRenderedIndex = -1;

			function renderThumbnail(index: number): string[] {
				const thumb = loadThumbnail(index);
				const name = screenshots[index]?.name?.slice(-20) || "?";

				// Delete previous image by ID when switching
				let deleteCmd = "";
				if (lastRenderedIndex !== -1 && lastRenderedIndex !== index) {
					deleteCmd = `\x1b_Ga=d,d=I,i=${9000 + lastRenderedIndex}\x1b\\`;
				}
				lastRenderedIndex = index;

				if (!thumb) {
					const lines: string[] = [];
					lines.push(deleteCmd + theme.fg("dim", `  [No preview: ${name}]`));
					for (let i = 1; i < CONTENT_LINES; i++) lines.push("");
					return lines;
				}

				try {
					// Get dimensions and calculate constrained width so height fits
					const dims = getPngDimensions(thumb.data);
					const maxWidth = dims ? calculateConstrainedWidth(dims, CONTENT_LINES) : MAX_WIDTH_CELLS;

					const img = new Image(thumb.data, thumb.mimeType, imageTheme, {
						maxWidthCells: maxWidth,
						imageId: 9000 + index,
					});
					const rendered = img.render(maxWidth + 2);

					// Image component returns (rows-1) empty lines, then cursor-up + image on last line.
					// Pass through all lines - the cursor-up positions the image correctly.
					const lines: string[] = [];
					for (let i = 0; i < CONTENT_LINES; i++) {
						const line = rendered[i] || "";
						lines.push(i === 0 ? deleteCmd + line : line);
					}
					return lines;
				} catch (err) {
					const lines: string[] = [];
					lines.push(deleteCmd + theme.fg("error", `  [Error: ${name}]`));
					for (let i = 1; i < CONTENT_LINES; i++) lines.push("");
					return lines;
				}
			}

			return {
				render(width: number) {
					const lines: string[] = [];
					const border = theme.fg("accent", "─".repeat(width));

					// Header (4 lines)
					const countInfo = screenshots.length > VISIBLE_ITEMS 
						? ` (${cursor + 1}/${screenshots.length})`
						: "";
					lines.push(border);
					lines.push(padToWidth(" " + theme.fg("accent", theme.bold("Recent Screenshots")) + theme.fg("dim", countInfo), LIST_WIDTH) + "│");
					lines.push(padToWidth(" " + theme.fg("dim", directory.slice(-40)), LIST_WIDTH) + "│");
					lines.push(padToWidth("", LIST_WIDTH) + "│");

					// Render thumbnail - brand new Image created each time
					const imageLines = renderThumbnail(cursor);

					// Content area: fixed CONTENT_LINES rows with scrolling
					for (let i = 0; i < CONTENT_LINES; i++) {
						const itemIndex = scrollOffset + i;
						let listLine = "";

						if (itemIndex < screenshots.length) {
							const screenshot = screenshots[itemIndex];
							const isStaged = alreadyStaged.has(itemIndex);
							const isCursor = itemIndex === cursor;

							// Show different indicators: ✓ = staged, ○ = not staged
							const checkbox = isStaged ? "✓" : "○";
							const cursorIndicator = isCursor ? "▸" : " ";

							const relTime = formatRelativeTime(screenshot.mtime);
							const size = formatSize(screenshot.size);
							const timeStr = screenshot.mtime.toLocaleTimeString("en-US", {
								hour: "2-digit",
								minute: "2-digit",
							});

							listLine = ` ${cursorIndicator} ${checkbox} ${timeStr} (${relTime}) - ${size}`;

							if (isStaged) {
								listLine = theme.fg("success", listLine);
							} else if (isCursor) {
								listLine = theme.fg("accent", listLine);
							} else {
								listLine = theme.fg("text", listLine);
							}
						}

						const paddedLine = padToWidth(listLine, LIST_WIDTH);
						const imageLine = imageLines[i] || "";
						lines.push(paddedLine + "│ " + imageLine);
					}

					// Footer (3 lines)
					const stagedCount = alreadyStaged.size;
					const hint = stagedCount > 0
						? `${stagedCount} staged • s/space stage more • d delete • enter done`
						: "↑↓ navigate • s/space stage • o open • d delete • enter done";
					lines.push(padToWidth("", LIST_WIDTH) + "│");
					lines.push(padToWidth(" " + theme.fg("dim", hint), LIST_WIDTH) + "│");
					lines.push(border);

					return lines;
				},
				invalidate() {
					// Nothing to invalidate
				},
				handleInput(data: string) {
					if (matchesKey(data, Key.up)) {
						cursor = Math.max(0, cursor - 1);
						if (cursor < scrollOffset) {
							scrollOffset = cursor;
						}
						tui.requestRender();
					} else if (matchesKey(data, Key.down)) {
						cursor = Math.min(screenshots.length - 1, cursor + 1);
						if (cursor >= scrollOffset + VISIBLE_ITEMS) {
							scrollOffset = cursor - VISIBLE_ITEMS + 1;
						}
						tui.requestRender();
					} else if (matchesKey(data, Key.space) || data === "s" || data === "S") {
						// Stage current screenshot immediately
						stageScreenshot(cursor);
						tui.requestRender();
					} else if (matchesKey(data, Key.enter)) {
						// Close selector (images already staged via s/space)
						done([]);
					} else if (matchesKey(data, Key.escape)) {
						done(null);
					} else if (data === "o") {
						// Open in default image viewer
						openFile(screenshots[cursor].path);
					} else if (data === "d" || data === "D") {
						// Delete the screenshot file from disk
						if (screenshots.length === 0) return;
						
						const screenshot = screenshots[cursor];
						try {
							unlinkSync(screenshot.path);
							
							// Remove from thumbnails cache if present
							thumbnails.delete(cursor);
							
							// Remove from alreadyStaged if it was staged
							if (alreadyStaged.has(cursor)) {
								// Find and remove the corresponding staged image
								const imgIndex = [...alreadyStaged].filter(i => i < cursor).length;
								if (imgIndex < stagedImages.length) {
									stagedImages.splice(imgIndex, 1);
								}
								alreadyStaged.delete(cursor);
							}
							
							// Update alreadyStaged indices (decrement indices > cursor)
							const newStaged = new Set<number>();
							for (const idx of alreadyStaged) {
								if (idx > cursor) {
									newStaged.add(idx - 1);
								} else {
									newStaged.add(idx);
								}
							}
							alreadyStaged.clear();
							for (const idx of newStaged) {
								alreadyStaged.add(idx);
							}
							
							// Rebuild thumbnails map with updated indices
							const newThumbnails = new Map<number, { data: string; mimeType: string } | null>();
							for (const [idx, thumb] of thumbnails) {
								if (idx > cursor) {
									newThumbnails.set(idx - 1, thumb);
								} else if (idx < cursor) {
									newThumbnails.set(idx, thumb);
								}
								// Skip idx === cursor (deleted)
							}
							thumbnails.clear();
							for (const [idx, thumb] of newThumbnails) {
								thumbnails.set(idx, thumb);
							}
							
							// Remove from screenshots array
							screenshots.splice(cursor, 1);
							
							// Adjust cursor if needed
							if (screenshots.length === 0) {
								done(null); // No more screenshots, close
								return;
							}
							if (cursor >= screenshots.length) {
								cursor = screenshots.length - 1;
							}
							
							// Adjust scroll offset if needed
							if (scrollOffset > 0 && scrollOffset >= screenshots.length - VISIBLE_ITEMS + 1) {
								scrollOffset = Math.max(0, screenshots.length - VISIBLE_ITEMS);
							}
							
							// Reset lastRenderedIndex to force re-render
							lastRenderedIndex = -1;
							
							tui.requestRender();
						} catch {
							// Silently fail if deletion fails
						}
					}
				},
			};
		});

		// User cancelled
		if (result === null) {
			return;
		}

		// Staging happened inside the UI via 's' key or Enter on selection
		// Just show notification if anything was staged
		if (alreadyStaged.size > 0) {
			const count = alreadyStaged.size;
			const totalStaged = stagedImages.length;
			const label = count === 1 ? "screenshot" : "screenshots";

			if (totalStaged > count) {
				ctx.ui.notify(`Added ${count} ${label} (${totalStaged} total). Type your message and send.`, "info");
			} else {
				ctx.ui.notify(`${count} ${label} staged. Type your message and send.`, "info");
			}
		}
	}

	// Helper to update the staged images widget
	function updateStagedWidget(ctx: ExtensionContext) {
		if (stagedImages.length > 0) {
			const label = stagedImages.length === 1 ? "screenshot" : "screenshots";
			ctx.ui.setWidget("screenshots-staged", [
				`📷 ${stagedImages.length} ${label} staged (/ssclear to remove)`,
			], { placement: "belowEditor" });
		} else {
			ctx.ui.setWidget("screenshots-staged", undefined);
		}
	}

	// Register command
	pi.registerCommand("ss", {
		description: "Show recent screenshots for quick attachment",
		handler: async (_args, ctx) => {
			await showScreenshotSelector(ctx);
			updateStagedWidget(ctx);
		},
	});

	// Register command to clear staged screenshots
	pi.registerCommand("ssclear", {
		description: "Clear staged screenshots",
		handler: async (_args, ctx) => {
			const count = stagedImages.length;
			stagedImages = [];
			updateStagedWidget(ctx);
			if (count > 0) {
				ctx.ui.notify(`Cleared ${count} staged screenshot${count === 1 ? "" : "s"}`, "info");
			} else {
				ctx.ui.notify("No staged screenshots to clear", "info");
			}
		},
	});

	// Register keyboard shortcut
	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Show recent screenshots",
		handler: async (ctx) => {
			await showScreenshotSelector(ctx);
			updateStagedWidget(ctx);
		},
	});
}
