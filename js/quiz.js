/**
 * quiz.js — 答题流程状态管理
 */

(function () {
  let questions = [];
  let types = [];
  let answers = {};       // { questionId: optionId }
  let currentIndex = 0;

  // ─── 初始化 ──────────────────────────────────────────────────────────────
  async function init() {
    try {
      const [qRes, tRes] = await Promise.all([
        fetch("data/questions.json"),
        fetch("data/types.json")
      ]);
      const qData = await qRes.json();
      const tData = await tRes.json();
      questions = qData.questions;
      types = tData.types;
    } catch (e) {
      console.error("数据加载失败", e);
      document.getElementById("quiz-error").style.display = "block";
      return;
    }

    renderQuestion(0);
    updateProgress();
  }

  // ─── 渲染题目 ─────────────────────────────────────────────────────────────
  function renderQuestion(index) {
    const q = questions[index];
    if (!q) return;

    const container = document.getElementById("question-container");
    const progressText = document.getElementById("progress-text");

    progressText.textContent = `${index + 1} / ${questions.length}`;

    const optionsHTML = q.options.map(opt => `
      <button
        class="option-btn"
        data-option-id="${opt.id}"
        onclick="QUIZ.selectOption('${opt.id}')"
      >
        <span class="option-id">${opt.id}</span>
        <span class="option-text">${opt.text}</span>
      </button>
    `).join("");

    const backVisible = currentIndex > 0;
    container.innerHTML = `
      <div class="question-card">
        <div class="question-id">${q.id}</div>
        <p class="question-text">${q.text}</p>
        <div class="options-list">
          ${optionsHTML}
        </div>
        <button
          id="back-btn"
          class="back-btn"
          onclick="QUIZ.goBack()"
          aria-label="返回上一题"
          style="visibility:${backVisible ? 'visible' : 'hidden'}"
        >←</button>
      </div>
    `;

    // 如果已有答案（回退场景），恢复选中状态
    if (answers[q.id]) {
      restoreSelection(answers[q.id]);
    }
  }

  // ─── 选项交互 ─────────────────────────────────────────────────────────────
  function selectOption(optionId) {
    const q = questions[currentIndex];
    answers[q.id] = optionId;

    // 视觉反馈
    document.querySelectorAll(".option-btn").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.optionId === optionId);
    });

    // 短暂延迟后前进，给用户看到选中状态
    setTimeout(() => advance(), 350);
  }

  function restoreSelection(optionId) {
    document.querySelectorAll(".option-btn").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.optionId === optionId);
    });
  }

  // ─── 前进 / 完成 ─────────────────────────────────────────────────────────
  function advance() {
    currentIndex++;
    updateProgress();

    if (currentIndex >= questions.length) {
      finishQuiz();
      return;
    }
    renderQuestion(currentIndex);
  }

  function updateProgress() {
    const bar = document.getElementById("progress-bar");
    if (!bar) return;
    const pct = questions.length > 0
      ? Math.round((currentIndex / questions.length) * 100)
      : 0;
    bar.style.width = pct + "%";
  }

  // ─── 返回上一题 ───────────────────────────────────────────────────────────
  function goBack() {
    if (currentIndex <= 0) return;
    currentIndex--;
    updateProgress();
    renderQuestion(currentIndex);
  }

  // ─── 完成答题 → 跳转结果页 ───────────────────────────────────────────────
  function finishQuiz() {
    const result = NBTI.calculate(answers, questions, types);

    // 将结果存入 sessionStorage，结果页读取
    sessionStorage.setItem("nbti_result", JSON.stringify(result));
    sessionStorage.setItem("nbti_answers", JSON.stringify(answers));

    window.location.href = "result.html";
  }

  // ─── 暴露给模板的接口 ─────────────────────────────────────────────────────
  window.QUIZ = { init, selectOption, goBack };

  document.addEventListener("DOMContentLoaded", init);
})();
