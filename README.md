# PBX NCLEX

Professional single-page NCLEX practice app with a PBX NCLEX splash screen, compact question selection menu, preloaded question bank, preserved original internal test console, final result screen, and local previous-test history.

## How to run

1. Unzip the repository.
2. Open `index.html` in Chrome or Edge.
3. Wait for the 5-second PBX NCLEX splash screen.
4. Select Test Mode, Question Mode, Subjects, Systems, and number of questions.
5. Click **Start Test**.

## Latest updates

- Last question **Next** button changes to **Done**.
- **Done** opens a final result box with score, correct, incorrect, omitted, marked, time, and points.
- Added **Previous Tests** button at the top right of the test console.
- Previous tests are saved in the browser using localStorage.
- Previous-test list shows score percentage and combined stats.
- Clicking a previous test reopens that exact generated test for review/continuation.
- Question selection menu uses Google Material icons.
- Build Test visual box and bottom question stats were removed.
- Systems are sorted by available question count and update according to selected subjects/status mode.
- Standard/Custom question mode now works: Standard locks to unused questions; Custom enables status selection.

## Notes

Some question explanations reference media paths such as `downloads/...`. If those media files are not present in the repository, the app will still run and display text/question data.
