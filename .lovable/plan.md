## Safe Area Spacing Fix for iPhone Notch/Home Indicator

### Problem
The app uses `viewport-fit=cover` (correct for edge-to-edge rendering), but several screens lack bottom safe-area padding, causing content to be hidden behind the iPhone home indicator and dynamic island. Additionally, `safe-top`/`safe-bottom` classes are defined inside `@layer base` in `index.css`, which means Tailwind utility classes (like `p-4`, `py-3`) can override them, breaking safe area insets.

### Solution
1. **Fix CSS layer priority**: Move `.safe-top` and `.safe-bottom` from `@layer base` to `@layer utilities` in `index.css` so they properly override or coexist with Tailwind padding utilities.
2. **Add safe-bottom to all scroll containers**: Every page with a `flex-1 overflow-y-auto` scrollable area gets a `safe-bottom` class or a safe-area spacer, ensuring the last items are not obscured by the home indicator.
3. **Add missing safe-top to Profile header**: The Profile page header lacks `safe-top`, causing it to sit under the dynamic island.

### Pages to modify

| File | Change |
|------|--------|
| `src/index.css` | Move `.safe-top` and `.safe-bottom` from `@layer base` to `@layer utilities` |
| `src/pages/Chat.tsx` | Add `safe-bottom` to the messages scroll container (`ref={scrollRef}`) |
| `src/pages/ClientDetail.tsx` | Add `safe-bottom` to the main scrollable content area |
| `src/pages/Clients.tsx` | Add `safe-bottom` to the contacts list scroll container |
| `src/pages/Dashboard.tsx` | Add `safe-bottom` to the dashboard scroll container |
| `src/pages/Properties.tsx` | Add `safe-bottom` to both Tab scroll containers |
| `src/pages/Favorites.tsx` | Add `safe-bottom` to the favorites scroll container |
| `src/pages/Profile.tsx` | Add `safe-top` to the header; add `safe-bottom` to the form/scroll container |

### Verification
After implementation, test on iPhone simulator or Safari responsive mode with a device frame that includes a home indicator (e.g., iPhone 14 Pro) to confirm:
- Header content is not hidden under the dynamic island.
- Last scrollable items are fully visible above the home indicator.
- Desktop layout remains unchanged (safe area insets evaluate to 0px).