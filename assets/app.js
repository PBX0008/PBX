(() => {
  "use strict";

  const STORAGE_KEY = "pbx_nclex_progress_v1";
  const SESSION_KEY = "pbx_nclex_last_session_v1";
  const SPLASH_MS = 5000;
  const $ = (id) => document.getElementById(id);

  const topData = window.PBX_QUESTION_DATA || { questionList: [] };
  let questionBank = normalizeQuestions(topData.questionList || []);
  let progress = loadProgress();
  let session = null;
  let setup = {
    testMode: "tutor",
    questionMode: "standard",
    statuses: new Set(["unused"]),
    subjects: new Set(),
    systems: new Set(),
    systemsExpanded: false,
    showExplanations: true,
    randomize: true,
  };
  let timerHandle = null;
  let questionStartedAt = Date.now();

  const statusDefs = [
    ["unused", "Unused"],
    ["incorrect", "Incorrect"],
    ["marked", "Marked"],
    ["omitted", "Omitted"],
    ["correct", "Correct"],
  ];

  function normalizeQuestions(list) {
    return list.map((q, idx) => ({
      ...q,
      _uid: String(q.questionId ?? q.questionIndex ?? q.sequenceId ?? idx),
      _sort: Number(q.sequenceId ?? idx + 1),
      _subject: q.subject || "Uncategorized",
      _system: q.system || "Uncategorized",
      _topic: q.topic || q.title || "General",
      _choices: Array.isArray(q.answerChoiceList) ? [...q.answerChoiceList].sort((a,b) => Number(a.choiceNumber) - Number(b.choiceNumber)) : []
    })).sort((a,b) => a._sort - b._sort);
  }

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }
  function saveProgress() { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
  function saveSession() { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function init() {
    setup.subjects = new Set(unique(questionBank.map(q => q._subject)));
    setup.systems = new Set(unique(questionBank.map(q => q._system)));
    setTimeout(() => {
      $("splash").classList.add("hidden");
      $("setupScreen").classList.remove("hidden");
      renderSetup();
    }, SPLASH_MS);
    bindSetupEvents();
    bindExamEvents();
  }

  function unique(arr) { return [...new Set(arr)].filter(Boolean); }
  function countBy(key) {
    const map = new Map();
    for (const q of questionBank) map.set(q[key], (map.get(q[key]) || 0) + 1);
    return map;
  }
  function naturalSort(a,b) { return String(a).localeCompare(String(b), undefined, {numeric:true, sensitivity:"base"}); }
  function preferredSubjectOrder(name) {
    const order = ["Adult Health","Pharmacology","Fundamentals","Child Health","Maternal & Newborn Health","Mental Health","Leadership & Management","Uncategorized"];
    const i = order.indexOf(name);
    return i === -1 ? 100 : i;
  }

  function getStatus(q) {
    const p = progress[q._uid] || {};
    if (p.marked && !p.submitted && !p.omitted) return "marked";
    if (p.omitted) return "omitted";
    if (p.submitted) return p.correct ? "correct" : "incorrect";
    return "unused";
  }
  function matchesStatuses(q) {
    const p = progress[q._uid] || {};
    if (setup.statuses.size === 0) return false;
    const primary = getStatus(q);
    return setup.statuses.has(primary) || (p.marked && setup.statuses.has("marked"));
  }
  function filteredQuestions() {
    return questionBank.filter(q => setup.subjects.has(q._subject) && setup.systems.has(q._system) && matchesStatuses(q));
  }
  function progressStats() {
    const out = {unused:0, incorrect:0, marked:0, omitted:0, correct:0};
    for (const q of questionBank) {
      const p = progress[q._uid] || {};
      const s = getStatus(q);
      out[s] = (out[s] || 0) + 1;
      if (p.marked) out.marked++;
    }
    return out;
  }

  function renderSetup() {
    const stats = progressStats();
    $("statCorrect").textContent = stats.correct;
    $("statIncorrect").textContent = stats.incorrect;
    $("statMarked").textContent = stats.marked;
    $("statOmitted").textContent = stats.omitted;

    renderStatusFilters(stats);
    renderSubjectFilters();
    renderSystemFilters();
    updateSelectedPool();
    $("tutorToggle").classList.toggle("active", setup.testMode === "tutor");
    $("timedToggle").classList.toggle("active", setup.testMode === "timed");
    $("standardBtn").classList.toggle("active", setup.questionMode === "standard");
    $("customBtn").classList.toggle("active", setup.questionMode === "custom");
    $("showExplanationsCheck").checked = setup.showExplanations;
    $("randomizeCheck").checked = setup.randomize;
  }

  function renderStatusFilters(stats) {
    const box = $("statusFilters");
    box.innerHTML = "";
    for (const [key, label] of statusDefs) {
      const id = `status_${key}`;
      const wrap = document.createElement("label");
      wrap.className = "filter-check";
      wrap.innerHTML = `<input id="${id}" type="checkbox" ${setup.statuses.has(key) ? "checked" : ""}/><span>${label}</span><strong class="count-badge">${stats[key] || 0}</strong>`;
      wrap.querySelector("input").addEventListener("change", (e) => {
        e.target.checked ? setup.statuses.add(key) : setup.statuses.delete(key);
        updateSelectedPool();
      });
      box.appendChild(wrap);
    }
  }

  function renderSubjectFilters() {
    const counts = countBy("_subject");
    const subjects = [...counts.keys()].sort((a,b) => preferredSubjectOrder(a) - preferredSubjectOrder(b) || naturalSort(a,b));
    const box = $("subjectFilters");
    box.innerHTML = "";
    for (const name of subjects) box.appendChild(makeFilterItem(name, counts.get(name), "subject", setup.subjects.has(name)));
    $("subjectsAll").checked = subjects.every(x => setup.subjects.has(x));
  }

  function renderSystemFilters() {
    const counts = countBy("_system");
    const systems = [...counts.keys()].sort((a,b) => counts.get(b) - counts.get(a) || naturalSort(a,b));
    const box = $("systemFilters");
    box.innerHTML = "";
    box.classList.toggle("collapsed", !setup.systemsExpanded);
    for (const name of systems) {
      const el = makeFilterItem(name, counts.get(name), "system", setup.systems.has(name));
      el.classList.add("system-item");
      box.appendChild(el);
    }
    $("systemsAll").checked = systems.every(x => setup.systems.has(x));
    $("expandSystemsBtn").textContent = setup.systemsExpanded ? "– Collapse" : "+ Expand All";
  }

  function makeFilterItem(name, count, type, checked) {
    const label = document.createElement("label");
    label.className = "item-check";
    label.title = name;
    label.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}/><span class="name">${escapeHTML(name)}</span><strong class="count-badge">${count}</strong>`;
    label.querySelector("input").addEventListener("change", e => {
      const set = type === "subject" ? setup.subjects : setup.systems;
      e.target.checked ? set.add(name) : set.delete(name);
      if (type === "subject") $("subjectsAll").checked = false;
      if (type === "system") $("systemsAll").checked = false;
      updateSelectedPool();
    });
    return label;
  }

  function updateSelectedPool() {
    const pool = filteredQuestions();
    $("totalAvailableChip").textContent = questionBank.length;
    $("selectedPoolCount").textContent = pool.length;
    const countInput = $("questionCountInput");
    countInput.max = Math.max(1, pool.length);
    if (Number(countInput.value) > pool.length) countInput.value = pool.length || 1;
    if (!countInput.value || Number(countInput.value) < 1) countInput.value = Math.min(85, pool.length || 1);
    $("setupMessage").textContent = pool.length ? "" : "No questions match the selected filters.";
  }

  function bindSetupEvents() {
    $("tutorToggle").addEventListener("click", () => { setup.testMode = "tutor"; renderSetup(); });
    $("timedToggle").addEventListener("click", () => { setup.testMode = "timed"; renderSetup(); });
    $("standardBtn").addEventListener("click", () => { setup.questionMode = "standard"; renderSetup(); });
    $("customBtn").addEventListener("click", () => { setup.questionMode = "custom"; renderSetup(); });
    $("subjectsAll").addEventListener("change", e => {
      setup.subjects = new Set(e.target.checked ? unique(questionBank.map(q=>q._subject)) : []);
      renderSubjectFilters(); updateSelectedPool();
    });
    $("systemsAll").addEventListener("change", e => {
      setup.systems = new Set(e.target.checked ? unique(questionBank.map(q=>q._system)) : []);
      renderSystemFilters(); updateSelectedPool();
    });
    $("expandSystemsBtn").addEventListener("click", () => { setup.systemsExpanded = !setup.systemsExpanded; renderSystemFilters(); });
    $("questionCountInput").addEventListener("input", updateSelectedPool);
    $("randomizeCheck").addEventListener("change", e => setup.randomize = e.target.checked);
    $("showExplanationsCheck").addEventListener("change", e => setup.showExplanations = e.target.checked);
    $("resetProgressBtn").addEventListener("click", () => {
      if (!confirm("Reset all saved correct/incorrect/marked/omitted progress?")) return;
      progress = {}; saveProgress(); renderSetup();
    });
    $("startTestBtn").addEventListener("click", startTest);
    $("jsonImport").addEventListener("change", handleImport);
  }

  function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const list = Array.isArray(imported) ? imported : imported.questionList;
        if (!Array.isArray(list) || !list.length) throw new Error("No questionList found");
        questionBank = normalizeQuestions(list);
        progress = {};
        setup.subjects = new Set(unique(questionBank.map(q => q._subject)));
        setup.systems = new Set(unique(questionBank.map(q => q._system)));
        setup.statuses = new Set(["unused"]);
        saveProgress();
        renderSetup();
        $("setupMessage").textContent = `Imported ${questionBank.length} questions.`;
      } catch (err) {
        $("setupMessage").textContent = "Could not import JSON: " + err.message;
      }
    };
    reader.readAsText(file);
  }

  function startTest() {
    let pool = filteredQuestions();
    if (!pool.length) { $("setupMessage").textContent = "Select at least one available question."; return; }
    if (setup.randomize) pool = shuffle(pool);
    const requested = Math.min(Math.max(1, Number($("questionCountInput").value) || 1), pool.length);
    session = {
      mode: setup.testMode,
      showExplanations: setup.showExplanations,
      ids: pool.slice(0, requested).map(q => q._uid),
      current: 0,
      answers: {},
      startedAt: Date.now(),
      elapsed: 0,
      ended: false,
    };
    for (const id of session.ids) session.answers[id] = { selected: "", submitted: false, correct: false, marked: Boolean((progress[id]||{}).marked), timeSpent: 0 };
    $("setupScreen").classList.add("hidden");
    $("examScreen").classList.remove("hidden");
    questionStartedAt = Date.now();
    startTimer();
    renderQuestion();
    saveSession();
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function bindExamEvents() {
    $("prevBtn").addEventListener("click", () => goQuestion(-1));
    $("nextBtn").addEventListener("click", () => nextAction());
    $("checkBtn").addEventListener("click", () => checkAnswer());
    $("markBtn").addEventListener("click", () => toggleMark());
    $("menuBtn").addEventListener("click", () => confirmMenu());
    $("endTestBtn").addEventListener("click", () => finishTest(true));
    $("calcBtn").addEventListener("click", showCalculator);
    $("labBtn").addEventListener("click", showLabs);
    $("notesBtn").addEventListener("click", showNotes);
    $("nightBtn").addEventListener("click", () => document.body.classList.toggle("night"));
    $("statsTabBtn").addEventListener("click", showStatsPanel);
    document.addEventListener("keydown", handleKeys);
  }

  function handleKeys(e) {
    if (!session || $("examScreen").classList.contains("hidden")) return;
    if (/^[1-9]$/.test(e.key)) selectChoice(e.key);
    if (e.key === "Enter") { e.preventDefault(); const cur = currentAnswer(); cur.submitted ? nextAction() : checkAnswer(); }
    if (e.key.toLowerCase() === "m") toggleMark();
  }

  function qById(id) { return questionBank.find(q => q._uid === id); }
  function currentQuestion() { return qById(session.ids[session.current]); }
  function currentAnswer() { return session.answers[session.ids[session.current]]; }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      if (!session) return;
      session.elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
      $("timerLabel").textContent = formatTime(session.elapsed);
    }, 1000);
  }
  function stopTimer() { if (timerHandle) clearInterval(timerHandle); timerHandle = null; }
  function formatTime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function renderQuestion() {
    const q = currentQuestion();
    const ans = currentAnswer();
    questionStartedAt = Date.now();
    $("examModeLabel").textContent = session.mode === "tutor" ? "Tutor Mode" : "Timed Mode";
    $("questionCounter").textContent = `Question ${session.current + 1} of ${session.ids.length}`;
    $("questionMeta").textContent = `Sequence ${q.sequenceId ?? "--"} • ${q._subject} • ${q._system}`;
    $("questionStem").innerHTML = sanitizeHTML(q.questionHeader || "") + sanitizeHTML(q.questionText || "");
    renderExhibits(q);
    renderChoices(q, ans);
    renderFeedback(q, ans);
    renderRationale(q, ans);
    const showResultPanel = ans.submitted && (session.mode === "tutor" ? session.showExplanations : session.ended);
    const examLayout = $("examLayout");
    if (examLayout) examLayout.classList.toggle("show-result", showResultPanel);
    updateBottom(q, ans);
    saveSession();
  }

  function renderExhibits(q) {
    const bar = $("exhibitBar");
    bar.innerHTML = "";
    if (!Array.isArray(q.exhibits) || !q.exhibits.length) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    q.exhibits.forEach((ex, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = ex.title || `Exhibit ${idx + 1}`;
      btn.addEventListener("click", () => showExhibit(ex));
      bar.appendChild(btn);
    });
  }

  function renderChoices(q, ans) {
    const list = $("choiceList");
    list.innerHTML = "";
    for (const choice of q._choices) {
      const num = String(choice.choiceNumber);
      const option = document.createElement("div");
      option.className = "choice-option";
      option.dataset.choice = num;
      if (ans.selected === num) option.classList.add("selected");
      if (ans.submitted && num === String(q.correctAnswer)) option.classList.add("correct");
      if (ans.submitted && ans.selected === num && num !== String(q.correctAnswer)) option.classList.add("incorrect");
      if (ans.submitted) option.classList.add("locked");
      option.innerHTML = `<span class="bubble">${ans.submitted && num === String(q.correctAnswer) ? "✓" : num}</span><span>${sanitizeHTML(decode(choice.choice || ""))}</span>`;
      option.addEventListener("click", () => { if (!ans.submitted) selectChoice(num); });
      list.appendChild(option);
    }
  }

  function selectChoice(num) {
    const q = currentQuestion();
    if (!q._choices.some(c => String(c.choiceNumber) === String(num))) return;
    const ans = currentAnswer();
    if (ans.submitted) return;
    ans.selected = String(num);
    renderChoices(q, ans);
    updateBottom(q, ans);
    saveSession();
  }

  function checkAnswer() {
    const q = currentQuestion();
    const ans = currentAnswer();
    if (ans.submitted) { nextAction(); return; }
    if (!ans.selected) { flashFeedback("Please select an answer first.", "partial"); return; }
    ans.timeSpent += Math.floor((Date.now() - questionStartedAt) / 1000);
    ans.submitted = true;
    ans.correct = String(ans.selected) === String(q.correctAnswer);
    progress[q._uid] = { ...(progress[q._uid] || {}), submitted: true, correct: ans.correct, omitted: false, answer: ans.selected, marked: ans.marked, lastSeen: new Date().toISOString(), timeSpent: ((progress[q._uid]||{}).timeSpent || 0) + ans.timeSpent };
    saveProgress();
    renderQuestion();
  }

  function flashFeedback(text, type) {
    const box = $("feedbackBox");
    box.textContent = text;
    box.className = `feedback-box ${type}`;
    box.classList.remove("hidden");
  }

  function renderFeedback(q, ans) {
    const box = $("feedbackBox");
    box.classList.add("hidden");
    if (!ans.submitted) return;
    if (session.mode === "timed" && !session.ended) {
      box.className = "feedback-box partial";
      box.textContent = "Answer saved. Correctness and rationale are available after the test is ended.";
      box.classList.remove("hidden");
      return;
    }
    box.className = `feedback-box ${ans.correct ? "correct" : "incorrect"}`;
    box.innerHTML = ans.correct ? "Correct. Good job." : `Incorrect. Correct answer: <strong>${escapeHTML(String(q.correctAnswer))}</strong>.`;
    box.classList.remove("hidden");
  }

  function renderRationale(q, ans) {
    const out = $("rationaleContent");
    out.className = "rationale-content";
    const canShow = ans.submitted && (session.mode === "tutor" ? session.showExplanations : session.ended);
    if (!canShow) {
      out.className = "rationale-content muted-message";
      out.textContent = session.mode === "timed" ? "Timed mode: rationales are hidden until the test is ended." : "Rationale will appear here after you check your answer.";
      return;
    }
    const correctChoice = q._choices.find(c => String(c.choiceNumber) === String(q.correctAnswer));
    out.innerHTML = `
      <div class="answer-summary"><strong>Correct answer:</strong> ${escapeHTML(String(q.correctAnswer))}. ${sanitizeHTML(decode(correctChoice?.choice || ""))}</div>
      ${sanitizeHTML(q.explanationText || "<p>No explanation available.</p>")}
    `;
    hideBrokenImages(out);
  }

  function updateBottom(q, ans) {
    $("prevBtn").disabled = session.current === 0;
    $("nextBtn").textContent = session.current === session.ids.length - 1 ? "Finish" : "Next";
    $("checkBtn").textContent = ans.submitted ? "Checked" : (session.mode === "tutor" ? "Check" : "Save");
    $("checkBtn").disabled = ans.submitted;
    $("savedLabel").textContent = ans.submitted ? (ans.correct ? "Answered correctly" : "Answered incorrectly") : (ans.selected ? `Selected option ${ans.selected}` : "Not answered");
    $("markBtn").textContent = ans.marked ? "Unmark" : "Mark";
  }

  function nextAction() {
    const ans = currentAnswer();
    if (session.mode === "timed" && ans.selected && !ans.submitted) checkAnswer();
    if (session.current === session.ids.length - 1) finishTest(false);
    else goQuestion(1);
  }

  function goQuestion(delta) {
    if (!session) return;
    const cur = currentAnswer();
    cur.timeSpent += Math.floor((Date.now() - questionStartedAt) / 1000);
    session.current = Math.max(0, Math.min(session.ids.length - 1, session.current + delta));
    renderQuestion();
  }

  function toggleMark() {
    const q = currentQuestion();
    const ans = currentAnswer();
    ans.marked = !ans.marked;
    progress[q._uid] = { ...(progress[q._uid] || {}), marked: ans.marked };
    saveProgress();
    updateBottom(q, ans);
    saveSession();
  }

  function finishTest(confirmFirst) {
    if (!session) return;
    if (confirmFirst && !confirm("End this test and mark blank questions as omitted?")) return;
    for (const id of session.ids) {
      const ans = session.answers[id];
      if (!ans.submitted) {
        progress[id] = { ...(progress[id] || {}), omitted: true, submitted: false, correct: false, marked: ans.marked, lastSeen: new Date().toISOString() };
      }
    }
    session.ended = true;
    saveProgress();
    saveSession();
    stopTimer();
    showReviewModal();
  }

  function confirmMenu() {
    if (session && !session.ended && !confirm("Return to menu? Current test will be closed but saved progress remains.")) return;
    stopTimer(); session = null; clearSession();
    $("examScreen").classList.add("hidden");
    $("setupScreen").classList.remove("hidden");
    renderSetup();
  }

  function showReviewModal() {
    const ids = session.ids;
    const answered = ids.filter(id => session.answers[id].submitted).length;
    const correct = ids.filter(id => session.answers[id].submitted && session.answers[id].correct).length;
    const incorrect = ids.filter(id => session.answers[id].submitted && !session.answers[id].correct).length;
    const omitted = ids.length - answered;
    const percent = answered ? Math.round((correct / answered) * 100) : 0;
    const map = ids.map((id, i) => {
      const a = session.answers[id];
      const cls = a.submitted ? (a.correct ? "correct" : "incorrect") : "";
      return `<button class="${cls}" data-go="${i}" type="button">${i+1}</button>`;
    }).join("");
    openModal("Test Review", `
      <div class="review-grid">
        <div><span>Score</span><strong>${percent}%</strong></div>
        <div><span>Correct</span><strong>${correct}</strong></div>
        <div><span>Incorrect</span><strong>${incorrect}</strong></div>
        <div><span>Omitted</span><strong>${omitted}</strong></div>
        <div><span>Time</span><strong>${formatTime(session.elapsed || 0)}</strong></div>
      </div>
      <p>Click a number to review that question. In review, explanations are visible.</p>
      <div class="question-map">${map}</div>
      <p style="margin-top:18px"><button class="btn primary" id="reviewCloseBtn" type="button">Return to Questions</button> <button class="btn" id="reviewMenuBtn" type="button">Back to Menu</button></p>
    `);
    document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { closeModal(); session.current = Number(b.dataset.go); renderQuestion(); }));
    $("reviewCloseBtn").addEventListener("click", closeModal);
    $("reviewMenuBtn").addEventListener("click", () => { closeModal(); confirmMenu(); });
  }

  function showStatsPanel() {
    if (!session) return;
    const ids = session.ids;
    const answered = ids.filter(id => session.answers[id].submitted).length;
    const correct = ids.filter(id => session.answers[id].submitted && session.answers[id].correct).length;
    const marked = ids.filter(id => session.answers[id].marked).length;
    $("rationaleContent").className = "rationale-content";
    $("rationaleContent").innerHTML = `<h3>Current Test Statistics</h3><div class="review-grid"><div><span>Answered</span><strong>${answered}/${ids.length}</strong></div><div><span>Correct</span><strong>${correct}</strong></div><div><span>Marked</span><strong>${marked}</strong></div><div><span>Elapsed</span><strong>${formatTime(session.elapsed || 0)}</strong></div></div>`;
  }

  function showExhibit(ex) {
    const filename = [ex.baseUrl || "", ex.fileName || ""].join("");
    openModal(ex.title || "Exhibit", `<p><strong>Exhibit file:</strong> ${escapeHTML(filename || "not supplied")}</p><p>This JSON references an external exhibit file. If you add the referenced file path to the repository, the app can be extended to load it directly. The current uploaded question bank contains the exhibit metadata but not the separate exhibit HTML/image files.</p>`);
  }

  function showCalculator() {
    openModal("Calculator", `<div class="calc-grid"><input id="calcDisplay" class="calc-display" readonly value="0" />${["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+","C"].map(v=>`<button type="button" data-calc="${v}">${v}</button>`).join("")}</div>`);
    let expr = "";
    document.querySelectorAll("[data-calc]").forEach(btn => btn.addEventListener("click", () => {
      const v = btn.dataset.calc, display = $("calcDisplay");
      if (v === "C") expr = "";
      else if (v === "=") { try { expr = String(Function(`return (${expr || 0})`)()); } catch { expr = "Error"; } }
      else { if (expr === "Error") expr = ""; expr += v; }
      display.value = expr || "0";
    }));
  }

  function showLabs() {
    openModal("Common Lab Values", `<table class="lab-table"><tr><td>WBC</td><td>5,000–10,000/mm³</td></tr><tr><td>Platelets</td><td>150,000–400,000/mm³</td></tr><tr><td>Hemoglobin</td><td>Female 12–16 g/dL; Male 14–18 g/dL</td></tr><tr><td>Sodium</td><td>135–145 mEq/L</td></tr><tr><td>Potassium</td><td>3.5–5.0 mEq/L</td></tr><tr><td>Creatinine</td><td>0.6–1.3 mg/dL</td></tr><tr><td>INR</td><td>0.8–1.1; therapeutic warfarin often 2–3</td></tr></table>`);
  }

  function showNotes() {
    const q = currentQuestion();
    const existing = (progress[q._uid] || {}).note || "";
    openModal("Question Notes", `<textarea id="noteText" class="notes-area" placeholder="Write your note here...">${escapeHTML(existing)}</textarea><p><button id="saveNoteBtn" class="btn primary" type="button">Save Note</button></p>`);
    $("saveNoteBtn").addEventListener("click", () => { progress[q._uid] = { ...(progress[q._uid] || {}), note: $("noteText").value }; saveProgress(); closeModal(); });
  }

  function openModal(title, body) {
    const layer = $("modalLayer");
    layer.innerHTML = `<div class="modal-card"><div class="modal-head"><span>${escapeHTML(title)}</span><button id="modalClose" type="button">Close</button></div><div class="modal-body">${body}</div></div>`;
    layer.classList.remove("hidden");
    $("modalClose").addEventListener("click", closeModal);
    layer.addEventListener("click", (e) => { if (e.target === layer) closeModal(); }, { once:true });
  }
  function closeModal() { $("modalLayer").classList.add("hidden"); $("modalLayer").innerHTML = ""; }

  function sanitizeHTML(html) {
    if (!html) return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), "text/html");
    doc.querySelectorAll("script, iframe, object, embed, form, input, button, style").forEach(el => el.remove());
    doc.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => {
        const n = attr.name.toLowerCase(), v = attr.value || "";
        if (n.startsWith("on")) el.removeAttribute(attr.name);
        if (["href","src"].includes(n) && /^(javascript|data:text\/html)/i.test(v.trim())) el.removeAttribute(attr.name);
        if (n === "contenteditable") el.removeAttribute(attr.name);
      });
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
      if (el.tagName === "IMG") { el.setAttribute("draggable", "false"); el.setAttribute("alt", el.getAttribute("alt") || "question image"); }
    });
    return doc.body.innerHTML;
  }
  function hideBrokenImages(root) {
    root.querySelectorAll("img").forEach(img => {
      img.addEventListener("error", () => img.classList.add("missing-img"));
    });
  }
  function decode(s) {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  }

  init();
})();
