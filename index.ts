/**
 * Screenshots Extension
 *
 * Shows recent screenshots in a panel for quick selection and attachment.
 * Works on macOS and Linux. Much faster than dragging files - just select and stage!
 *
 * Features:
 * - Shows all recent screenshots with scrollable list
 * - Multiple source directories with tabs (Ctrl+T to cycle)
 * - Supports glob patterns for flexible file matching
 * - Displays relative timestamps (e.g., "2 minutes ago")
 * - Shows thumbnail preview of selected screenshot
 * - Press 'o' to open in default image viewer
 * - Stage multiple screenshots with s/space (checkmark indicator)
 * - Shows widget indicator when screenshots are staged
 * - Type your message after staging, images attach on send
 *
 * Usage:
 *   /ss              - Show screenshot selector (stages images)
 *   /ss-clear        - Clear staged screenshots
 *   Ctrl+Shift+S     - Quick access shortcut
 *   Ctrl+Shift+X     - Clear all staged screenshots
 *
 * Keys:
 *   Up/Down          - Navigate screenshots
 *   Ctrl+T           - Cycle through source tabs
 *   s / space        - Stage/unstage current screenshot
 *   x                - Clear all staged screenshots
 *   o                - Open in default viewer
 *   d                - Delete screenshot from disk
 *   enter            - Close selector
 *   esc              - Cancel
 *
 * Workflow:
 *   1. Press Ctrl+Shift+S or /ss to open selector
 *   2. Use Ctrl+T to switch between source tabs (if multiple configured)
 *   3. Navigate with Up/Down, press s/space to stage screenshots (checkmark appears)
 *   4. Press Enter to close selector
 *   5. Type your message in the prompt
 *   6. Press Enter to send - staged images are automatically attached
 *
 * Configuration (in ~/.pi/agent/settings.json):
 *   {
 *     "pi-screenshots": {
 *       "sources": [
 *         "~/Pictures/Screenshots",
 *         "/path/to/images/*.png"
 *       ]
 *     }
 *   }
 *
 *   Sources can be:
 *   - Plain directories: scans for screenshot-named PNGs
 *   - Glob patterns: matches any file matching the pattern
 *
 *   Environment variable PI_SCREENSHOTS_DIR is also supported as fallback.
 *
 * Default screenshot locations (when no config):
 *   macOS: reads from screencapture preferences, falls back to ~/Desktop
 *   Linux: ~/Pictures/Screenshots, ~/Pictures, ~/Screenshots, or ~/Desktop
 *
 * Remote Development:
 *   For remote development via SSH, use external sync tools:
 *   - SSHFS: Mount remote folder locally (simplest)
 *   - Syncthing: Continuous file sync (most robust)
 *   See README for details.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ImageContent } from "@mariozechner/pi-coding-agent";
import { Image, Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { globSync } from "glob";

interface ScreenshotInfo {
	path: string;
	name: string;
	mtime: Date;
	size: number;
}

interface SourceTab {
	label: string;
	pattern: string;
	screenshots: ScreenshotInfo[];
}

interface Config {
	sources?: string[];
}

const SCREENSHOT_PATTERNS = [
	// macOS patterns
	/^Screenshot\s/i, // English: "Screenshot 2024-01-30..."
	/^Capture\s/i, // French: "Capture d'ecran..."
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
 * Expand ~ to home directory.
 */
function expandPath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Check if a pattern contains glob characters.
 */
function isGlobPattern(pattern: string): boolean {
	return /[*?[\]{}!]/.test(pattern);
}

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
 * Load extension config from settings.json.
 */
function loadConfig(): Config {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	if (existsSync(settingsPath)) {
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			if (settings["pi-screenshots"]) {
				return settings["pi-screenshots"];
			}
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
 * Get screenshots from a plain directory (with screenshot name filtering).
 */
function getScreenshotsFromDirectory(directory: string): ScreenshotInfo[] {
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
			try {
				const stats = statSync(path);
				return {
					path,
					name,
					mtime: stats.mtime,
					size: stats.size,
				};
			} catch {
				return null;
			}
		})
		.filter((f): f is ScreenshotInfo => f !== null);

	return files;
}

/**
 * Get screenshots from a glob pattern (no name filtering - pattern defines what to match).
 */
function getScreenshotsFromGlob(pattern: string): ScreenshotInfo[] {
	try {
		const expandedPattern = expandPath(pattern);
		const files = globSync(expandedPattern, { nodir: true });

		return files
			.filter((path) => {
				// Only include image files
				const ext = path.toLowerCase();
				return ext.endsWith(".png") || ext.endsWith(".jpg") || ext.endsWith(".jpeg") || ext.endsWith(".webp");
			})
			.map((path) => {
				try {
					const stats = statSync(path);
					return {
						path: resolve(path),
						name: basename(path),
						mtime: stats.mtime,
						size: stats.size,
					};
				} catch {
					return null;
				}
			})
			.filter((f): f is ScreenshotInfo => f !== null);
	} catch {
		return [];
	}
}

/**
 * Get screenshots from a source (handles both directories and glob patterns).
 */
function getScreenshotsFromSource(source: string): ScreenshotInfo[] {
	const expanded = expandPath(source);

	if (isGlobPattern(expanded)) {
		return getScreenshotsFromGlob(expanded);
	}

	// Plain directory - use screenshot name filtering
	return getScreenshotsFromDirectory(expanded);
}

/**
 * Create a short label from a source pattern.
 */
function createSourceLabel(source: string): string {
	const expanded = expandPath(source);

	if (isGlobPattern(expanded)) {
		// For globs, use the directory part + pattern hint
		const dir = dirname(expanded.split("*")[0]);
		const dirName = basename(dir) || dir;
		return dirName.slice(0, 15);
	}

	// For directories, use the last component
	return basename(expanded).slice(0, 15);
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
	const ext = path.toLowerCase();
	let mimeType = "image/png";
	if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mimeType = "image/jpeg";
	else if (ext.endsWith(".webp")) mimeType = "image/webp";

	return {
		data: buffer.toString("base64"),
		mimeType,
	};
}

export default function screenshotsExtension(pi: ExtensionAPI) {
	const config = loadConfig();

	// Staged images waiting to be sent with the next user message
	let stagedImages: ImageContent[] = [];
	// Track staged paths at module level so picker can show ✓ on reopening
	let stagedPaths = new Set<string>();

	/**
	 * Get source tabs based on configuration.
	 */
	function getSourceTabs(): SourceTab[] {
		const sources = config.sources && config.sources.length > 0
			? [...config.sources]
			: [process.env.PI_SCREENSHOTS_DIR || getDefaultScreenshotDir()];

		return sources.map((source) => {
			const screenshots = getScreenshotsFromSource(source);
			// Sort by mtime descending (most recent first)
			screenshots.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			return {
				label: createSourceLabel(source),
				pattern: source,
				screenshots,
			};
		});
	}

	// Intercept input events to attach staged images
	pi.on("input", (event, ctx) => {
		if (stagedImages.length === 0) {
			return { action: "continue" as const };
		}

		// Attach staged images to the user's message
		const imagesToAttach = [...stagedImages];
		stagedImages = []; // Clear staged images
		stagedPaths.clear(); // Clear staged paths so picker doesn't show old ✓ state

		// Clear the widget
		ctx.ui.setWidget("screenshots-staged", undefined);

		return {
			action: "transform" as const,
			text: event.text,
			images: [...(event.images || []), ...imagesToAttach],
		};
	});

	// Helper to get PNG/JPEG dimensions
	function getImageDimensions(base64Data: string, mimeType: string): { width: number; height: number } | null {
		try {
			const buffer = Buffer.from(base64Data, "base64");

			if (mimeType === "image/png") {
				if (buffer.length < 24) return null;
				if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null;
				return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
			}

			// For JPEG/WebP, just return null and let the image component handle it
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Show screenshot selector UI with tabs.
	 */
	async function showScreenshotSelector(ctx: ExtensionContext): Promise<void> {
		let tabs = getSourceTabs();

		// Filter out empty tabs
		const nonEmptyTabs = tabs.filter((t) => t.screenshots.length > 0);

		if (nonEmptyTabs.length === 0) {
			const sources = config.sources?.join(", ") || getDefaultScreenshotDir();
			ctx.ui.notify(`No screenshots found in: ${sources}`, "warning");
			return;
		}

		tabs = nonEmptyTabs;

		// Detect SSH session - inline images don't work over SSH
		const isSSH = !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT);

		// Lazy-load thumbnails (load on demand, skip files > 5MB)
		const MAX_THUMB_SIZE = 5 * 1024 * 1024; // 5MB
		const thumbnails: Map<string, { data: string; mimeType: string } | null> = new Map();

		function loadThumbnail(screenshot: ScreenshotInfo): { data: string; mimeType: string } | null {
			if (thumbnails.has(screenshot.path)) {
				return thumbnails.get(screenshot.path) || null;
			}
			if (screenshot.size > MAX_THUMB_SIZE) {
				thumbnails.set(screenshot.path, null);
				return null;
			}
			try {
				const img = loadImageBase64(screenshot.path);
				thumbnails.set(screenshot.path, img);
				return img;
			} catch {
				thumbnails.set(screenshot.path, null);
				return null;
			}
		}

		// Track which screenshots have been staged during this session (by path)
		// Initialize from module-level stagedPaths so reopening shows previously staged items
		const alreadyStaged = new Set<string>(stagedPaths);

		const result = await ctx.ui.custom<string[] | null>((tui, theme, _kb, done) => {
			let activeTab = 0;
			let cursor = 0;
			let scrollOffset = 0;
			const LIST_WIDTH = 45;
			const VISIBLE_ITEMS = 10;
			const CONTENT_LINES = 10;

			// Track double-n for nuke
			let nukeWarning = false;

			const imageTheme = {
				fallbackColor: (s: string) => theme.fg("dim", s),
			};

			// Get current tab's screenshots
			function getCurrentScreenshots(): ScreenshotInfo[] {
				return tabs[activeTab]?.screenshots || [];
			}

			// Helper to toggle stage/unstage a screenshot
			function toggleStageScreenshot(screenshot: ScreenshotInfo): void {
				if (alreadyStaged.has(screenshot.path)) {
					// Unstage - remove from stagedImages, alreadyStaged, and stagedPaths
					const pathsArray = [...alreadyStaged];
					const pathIndex = pathsArray.indexOf(screenshot.path);
					if (pathIndex !== -1) {
						stagedImages.splice(pathIndex, 1);
					}
					alreadyStaged.delete(screenshot.path);
					stagedPaths.delete(screenshot.path);
					return;
				}

				// Stage - add to stagedImages and track path
				try {
					const img = loadImageBase64(screenshot.path);
					stagedImages.push({
						type: "image",
						mimeType: img.mimeType,
						data: img.data,
					});
					alreadyStaged.add(screenshot.path);
					stagedPaths.add(screenshot.path);
				} catch {
					// Silently fail for individual staging
				}
			}

			// Helper to clear all staged screenshots
			function clearAllStaged(): void {
				stagedImages = [];
				alreadyStaged.clear();
				stagedPaths.clear();
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

			let lastRenderedPath = "";

			function renderThumbnail(screenshot: ScreenshotInfo): string[] {
				const thumb = loadThumbnail(screenshot);
				const name = screenshot.name.slice(-20);

				// Delete previous image by ID when switching
				let deleteCmd = "";
				if (lastRenderedPath && lastRenderedPath !== screenshot.path) {
					deleteCmd = `\x1b_Ga=d,d=I,i=9000\x1b\\`;
				}
				lastRenderedPath = screenshot.path;

				if (!thumb) {
					const lines: string[] = [];
					lines.push(deleteCmd + theme.fg("dim", `  [No preview: ${name}]`));
					for (let i = 1; i < CONTENT_LINES; i++) lines.push("");
					return lines;
				}

				try {
					// Get dimensions and calculate constrained width so height fits
					const dims = getImageDimensions(thumb.data, thumb.mimeType);
					const maxWidth = dims ? calculateConstrainedWidth(dims, CONTENT_LINES) : MAX_WIDTH_CELLS;

					const img = new Image(thumb.data, thumb.mimeType, imageTheme, {
						maxWidthCells: maxWidth,
						imageId: 9000,
					});
					const rendered = img.render(maxWidth + 2);

					// Check if this is a text fallback (no image support)
					const firstLine = rendered[0] || "";
					if (firstLine.includes("[Image:") || firstLine.includes("[image/")) {
						// Terminal doesn't support inline images - show helpful message
						const lines: string[] = [];
						const sizeInfo = dims ? `${dims.width}x${dims.height}` : "";
						lines.push(deleteCmd + theme.fg("dim", `  ${name} ${sizeInfo}`));
						lines.push("");
						if (isSSH) {
							lines.push(theme.fg("dim", "  Add to remote ~/.bashrc or ~/.zshrc:"));
							lines.push(theme.fg("dim", "  export TERM_PROGRAM=ghostty|kitty|WezTerm|iTerm.app"));
						} else {
							lines.push(theme.fg("dim", "  Thumbnails require Kitty, iTerm2,"));
							lines.push(theme.fg("dim", "  WezTerm, or Ghostty terminal"));
						}
						for (let i = lines.length; i < CONTENT_LINES; i++) lines.push("");
						return lines;
					}

					// Image component returns (rows-1) empty lines, then cursor-up + image on last line.
					const lines: string[] = [];
					for (let i = 0; i < CONTENT_LINES; i++) {
						const line = rendered[i] || "";
						lines.push(i === 0 ? deleteCmd + line : line);
					}
					return lines;
				} catch {
					const lines: string[] = [];
					lines.push(deleteCmd + theme.fg("error", `  [Error: ${name}]`));
					for (let i = 1; i < CONTENT_LINES; i++) lines.push("");
					return lines;
				}
			}

			return {
				render(width: number) {
					const lines: string[] = [];
					const border = theme.fg("accent", "\u2500".repeat(width));
					const screenshots = getCurrentScreenshots();

					// Header
					lines.push(border);

					// Tabs (if multiple sources)
					if (tabs.length > 1) {
						let tabLine = " ";
						for (let i = 0; i < tabs.length; i++) {
							const tab = tabs[i];
							const count = tab.screenshots.length;
							const label = `${tab.label} (${count})`;

							if (i === activeTab) {
								tabLine += theme.fg("accent", theme.bold(`[${label}]`));
							} else {
								tabLine += theme.fg("dim", ` ${label} `);
							}
							tabLine += " ";
						}
						tabLine += theme.fg("dim", "  Ctrl+T: switch");
						lines.push(padToWidth(tabLine, LIST_WIDTH) + "\u2502");
						lines.push(padToWidth("", LIST_WIDTH) + "\u2502");
					}

					// Title
					const countInfo = screenshots.length > VISIBLE_ITEMS ? ` (${cursor + 1}/${screenshots.length})` : "";
					lines.push(
						padToWidth(" " + theme.fg("accent", theme.bold("Recent Screenshots")) + theme.fg("dim", countInfo), LIST_WIDTH) +
							"\u2502"
					);

					// Source path hint
					const sourcePath = expandPath(tabs[activeTab].pattern).slice(-40);
					lines.push(padToWidth(" " + theme.fg("dim", sourcePath), LIST_WIDTH) + "\u2502");
					lines.push(padToWidth("", LIST_WIDTH) + "\u2502");

					// Render thumbnail for current selection
					const currentScreenshot = screenshots[cursor];
					const imageLines = currentScreenshot ? renderThumbnail(currentScreenshot) : Array(CONTENT_LINES).fill("");

					// Content area: fixed CONTENT_LINES rows with scrolling
					for (let i = 0; i < CONTENT_LINES; i++) {
						const itemIndex = scrollOffset + i;
						let listLine = "";

						if (itemIndex < screenshots.length) {
							const screenshot = screenshots[itemIndex];
							const isStaged = alreadyStaged.has(screenshot.path);
							const isCursor = itemIndex === cursor;

							// Show different indicators
							const checkbox = isStaged ? "\u2713" : "\u25CB";
							const cursorIndicator = isCursor ? "\u25B8" : " ";

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
						lines.push(paddedLine + "\u2502 " + imageLine);
					}

					// Footer
					const stagedCount = alreadyStaged.size;
					lines.push("");
					if (nukeWarning) {
						lines.push(" " + theme.fg("error", "\u26A0 Press n again to DELETE ALL screenshots in this source!"));
						lines.push(" " + theme.fg("dim", "Any other key to cancel"));
					} else if (stagedCount === 0) {
						lines.push(" " + theme.fg("warning", "\u26A0 Press s/space to stage screenshots before closing"));
						lines.push(" " + theme.fg("dim", "\u2191\u2193 nav \u2022 s/space toggle \u2022 o open \u2022 d delete \u2022 nn nuke \u2022 enter done"));
					} else {
						lines.push(" " + theme.fg("success", `\u2713 ${stagedCount} staged`));
						lines.push(" " + theme.fg("dim", "s/space toggle \u2022 x clear all \u2022 d delete \u2022 nn nuke \u2022 enter done"));
					}
					lines.push(border);

					return lines;
				},
				invalidate() {
					// Nothing to invalidate
				},
				handleInput(data: string) {
					const screenshots = getCurrentScreenshots();

					// Helper to clean up displayed image before exiting
					function cleanupImage() {
						if (lastRenderedPath) {
							process.stdout.write(`\x1b_Ga=d,d=I,i=9000\x1b\\`);
						}
					}

					// Handle nuke confirmation
					if (nukeWarning) {
						if (data === "n" || data === "N") {
							// Double-n confirmed - nuke all files in current source
							const tabScreenshots = tabs[activeTab].screenshots;
							for (const screenshot of [...tabScreenshots]) {
								try {
									unlinkSync(screenshot.path);
									thumbnails.delete(screenshot.path);
									if (alreadyStaged.has(screenshot.path)) {
										const pathsArray = [...alreadyStaged];
										const pathIndex = pathsArray.indexOf(screenshot.path);
										if (pathIndex !== -1) {
											stagedImages.splice(pathIndex, 1);
										}
										alreadyStaged.delete(screenshot.path);
										stagedPaths.delete(screenshot.path);
									}
								} catch {
									// Silently fail for individual files
								}
							}
							tabScreenshots.length = 0; // Clear the array

							// Check if there are other non-empty tabs
							const nonEmptyTabIndex = tabs.findIndex((t, i) => i !== activeTab && t.screenshots.length > 0);
							if (nonEmptyTabIndex !== -1) {
								activeTab = nonEmptyTabIndex;
								cursor = 0;
								scrollOffset = 0;
							} else {
								cleanupImage();
								done(null); // No more screenshots anywhere
								return;
							}

							nukeWarning = false;
							lastRenderedPath = "";
							cursor = 0;
							scrollOffset = 0;
							tui.requestRender();
						} else {
							// Any other key cancels nuke
							nukeWarning = false;
							tui.requestRender();
						}
						return;
					}

					// Ctrl+T to cycle tabs
					if (matchesKey(data, Key.ctrl("t"))) {
						if (tabs.length > 1) {
							activeTab = (activeTab + 1) % tabs.length;
							cursor = 0;
							scrollOffset = 0;
							lastRenderedPath = ""; // Force thumbnail refresh
							tui.requestRender();
						}
						return;
					}

					// First n press - show warning
					if (data === "n" || data === "N") {
						nukeWarning = true;
						tui.requestRender();
						return;
					}

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
						// Toggle stage/unstage current screenshot
						if (screenshots[cursor]) {
							toggleStageScreenshot(screenshots[cursor]);
							tui.requestRender();
						}
					} else if (matchesKey(data, Key.enter)) {
						// Close selector (images already staged via s/space)
						cleanupImage();
						done([]);
					} else if (matchesKey(data, Key.escape)) {
						cleanupImage();
						done(null);
					} else if (data === "o") {
						// Open in default image viewer
						if (screenshots[cursor]) {
							openFile(screenshots[cursor].path);
						}
					} else if (data === "x" || data === "X") {
						// Clear all staged screenshots
						if (alreadyStaged.size > 0) {
							clearAllStaged();
							tui.requestRender();
						}
					} else if (data === "d" || data === "D") {
						// Delete the screenshot file from disk
						if (screenshots.length === 0) return;

						const screenshot = screenshots[cursor];
						try {
							unlinkSync(screenshot.path);

							// Remove from thumbnails cache
							thumbnails.delete(screenshot.path);

							// Remove from alreadyStaged if it was staged
							if (alreadyStaged.has(screenshot.path)) {
								const pathsArray = [...alreadyStaged];
								const pathIndex = pathsArray.indexOf(screenshot.path);
								if (pathIndex !== -1) {
									stagedImages.splice(pathIndex, 1);
								}
								alreadyStaged.delete(screenshot.path);
								stagedPaths.delete(screenshot.path);
							}

							// Remove from current tab's screenshots
							const tabScreenshots = tabs[activeTab].screenshots;
							const idx = tabScreenshots.findIndex((s) => s.path === screenshot.path);
							if (idx !== -1) {
								tabScreenshots.splice(idx, 1);
							}

							// Adjust cursor if needed
							if (tabScreenshots.length === 0) {
								// Check if there are other non-empty tabs
								const nonEmptyTabIndex = tabs.findIndex((t, i) => i !== activeTab && t.screenshots.length > 0);
								if (nonEmptyTabIndex !== -1) {
									activeTab = nonEmptyTabIndex;
									cursor = 0;
									scrollOffset = 0;
								} else {
									cleanupImage();
									done(null); // No more screenshots, close
									return;
								}
							} else {
								if (cursor >= tabScreenshots.length) {
									cursor = tabScreenshots.length - 1;
								}
								if (scrollOffset > 0 && scrollOffset >= tabScreenshots.length - VISIBLE_ITEMS + 1) {
									scrollOffset = Math.max(0, tabScreenshots.length - VISIBLE_ITEMS);
								}
							}

							lastRenderedPath = ""; // Force thumbnail refresh
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

		// Show notification if anything was staged
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
			ctx.ui.setWidget(
				"screenshots-staged",
				[`\uD83D\uDCF7 ${stagedImages.length} ${label} staged (Ctrl+Shift+X to clear)`],
				{ placement: "belowEditor" }
			);
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
	pi.registerCommand("ss-clear", {
		description: "Clear staged screenshots",
		handler: async (_args, ctx) => {
			const count = stagedImages.length;
			stagedImages = [];
			stagedPaths.clear();
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

	// Register shortcut to clear staged screenshots
	pi.registerShortcut(Key.ctrlShift("x"), {
		description: "Clear staged screenshots",
		handler: async (ctx) => {
			const count = stagedImages.length;
			stagedImages = [];
			stagedPaths.clear();
			updateStagedWidget(ctx);
			if (count > 0) {
				ctx.ui.notify(`Cleared ${count} staged screenshot${count === 1 ? "" : "s"}`, "info");
			}
		},
	});
}
