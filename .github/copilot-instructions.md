# Seminar Cloud App - AI Coding Instructions

## Architecture Overview

This is a single-page web application (`index.html`) for recording and managing video sessions in educational settings. The app uses vanilla JavaScript with Firebase integration and can operate in both online and offline modes.

### Core Components

- **Single HTML file architecture**: All code (HTML, CSS, JS) is contained in `index.html`
- **Firebase integration**: Authentication, Firestore database, and Cloud Storage for video uploads
- **MediaRecorder API**: Native browser video recording with WebRTC camera access
- **IndexedDB caching**: Offline storage for failed uploads with automatic retry mechanisms
- **State management**: Manual DOM manipulation using `show()/hide()` functions with `style.display`

### Key State Variables

```javascript
let app, auth, db, storage; // Firebase services
let currentUserId = null; // Firebase UID
let mediaStream = null, mediaRecorder = null, chunks = []; // Recording state
let recordingsListener = null; // Firestore real-time listener
let classData = {}; // Period/student mapping
let session = { total:0, uploaded:0, retried:0, failed:0, start:0 }; // Sync tracking
```

## Development Patterns

### Screen Management
The app has 4 main screens controlled by `showScreen(id)`:
- `loading-screen`: App initialization
- `setup-screen`: Firebase configuration input
- `auth-screen`: Google authentication linking
- `main-app`: Primary recording interface

### Error Handling
Global error catchers display JavaScript errors in a red banner at top of page:
```javascript
window.onerror = function(message, source, lineno, colno, error) {
  errorMessageEl.textContent = `Message: ${message}...`;
  errorDisplay.style.display = 'block';
};
```

### Firebase Configuration
App supports multiple config sources:
1. localStorage (persistent)
2. Global variables `__firebase_config` and `__app_id`
3. User input via setup screen

Configuration is validated requiring: `apiKey`, `projectId`, `appId`.

### Offline-First Design
- Uses IndexedDB via custom helpers (`idbAdd`, `idbGetAll`, `idbDelete`)
- Failed uploads cached in `pendingUploads` object store
- Automatic retry on network reconnection
- Network status banner shows online/offline state

### Recording Workflow
1. `startRecording()` - Gets MediaStream, creates MediaRecorder
2. User can pause/resume during recording
3. `stopRecording()` - Creates blob, shows metadata form
4. Form submission triggers upload to Firebase Storage + Firestore

## Key File Paths & Naming

### Storage Paths
Videos uploaded to: `artifacts/{appId}/users/{userId}/media/{timestamp}_{studentName}.webm`

### Firestore Collections
- User recordings: `artifacts/{appId}/users/{userId}/recordings`
- Class settings: `artifacts/{appId}/users/{userId}/appData/classSettings`

### LocalStorage Keys
- `firebaseConfig`: Firebase configuration object
- `appId`: Application namespace identifier
- `classData_{userId}`: Cached class period data
- `syncHistory`: Array of recent sync operations

## Common Development Tasks

### Adding New Form Fields
Metadata forms use Tailwind classes: `bg-gray-700 border border-gray-600 rounded-lg py-2 px-3`

### Video Format Support
App prefers WebM with VP9/VP8 codecs. Check `MediaRecorder.isTypeSupported()` before use:
```javascript
const opts=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
```

### Sync Progress UI
Upload progress shown via `syncProgress` banner with real-time log in collapsible `syncLog` div. Use `logLine(msg, type)` for consistent formatting.

### Camera Management
Supports front/back camera switching via `currentFacingMode` variable. Cannot switch during active recording.

## Testing Modes

- **Online mode**: Full Firebase integration
- **Offline mode**: Local-only storage with sync queue
- **Anonymous auth**: Default Firebase authentication
- **Google-linked**: Enhanced authentication for data persistence

## Critical Dependencies

- Firebasev13.6.1 (imported via CDN)
- Tailwind CSS (CDN)
- MediaRecorder API (requires HTTPS for camera access)
- IndexedDB (for offline caching)

## Performance Considerations

- Video blobs stored in memory during recording
- IndexedDB has storage quotas (handle storage errors gracefully)
- MediaRecorder generates data chunks every 1000ms
- Firebase uploads use resumable uploads for large video files