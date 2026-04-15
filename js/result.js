/**
 * result.js — 结果页渲染
 */

(function () {

  // 人格图文件名映射（typeId → 文件名，不含路径和后缀）
  const IMG_MAP = {
    "404":      "page404",
    "403":      "403",
    "?":        "question",
    "DAMN":     "imgNULL",
    "NPC":      null   // 随机，见下方 getImgName()
  };

  function getImgName(typeId) {
    if (typeId === "NPC") {
      return Math.random() < 0.5 ? "npc" : "npc-f";
    }
    if (typeId === "MIAO") return "miao-";
    if (typeId in IMG_MAP) return IMG_MAP[typeId];
    return typeId.toLowerCase();
  }

  // ─── 初始化 ──────────────────────────────────────────────────────────────
  async function init() {
    const resultRaw = sessionStorage.getItem("nbti_result");
    if (!resultRaw) {
      window.location.href = "quiz.html";
      return;
    }

    const result = JSON.parse(resultRaw);

    let typeData     = null;
    let dimConfig    = [];

    try {
      const [tRes, dRes] = await Promise.all([
        fetch("data/types.json"),
        fetch("data/dimensions.json")
      ]);
      const tData = await tRes.json();
      const dData = await dRes.json();
      typeData  = tData.types.find(t => t.id === result.typeId);
      dimConfig = dData.dimensions;
    } catch (e) {
      console.error("数据加载失败", e);
    }

    renderResult(result, typeData, dimConfig);
  }

  // ─── 主渲染 ──────────────────────────────────────────────────────────────
  function renderResult(result, typeData, dimConfig) {
    const typeId = result.typeId;
    const label  = typeData ? typeData.label       : typeId;
    const nameCN = typeData ? (typeData.nameCN || "") : "";
    const desc   = typeData ? typeData.description : "（待填充）";
    const tagline = typeData ? (typeData.tagline || "") : "";

    // 特殊样式 class（用于 404/403 HTTP 报错风格）
    applyBodyClass(typeId);

    // 人格图
    const imgEl = document.getElementById("type-img");
    const imgName = getImgName(typeId);
    imgEl.src = `人格图dev/${imgName}.png`;
    imgEl.alt = label;

    // 类型名
    document.getElementById("type-name").textContent = label;

    // 中文名（如果有）
    const nameCNEl = document.getElementById("type-name-cn");
    if (nameCN) {
      nameCNEl.textContent = nameCN;
    } else {
      nameCNEl.style.display = "none";
    }

    // 一句话标语
    const taglineEl = document.getElementById("type-tagline");
    if (tagline) {
      taglineEl.textContent = tagline;
    } else {
      taglineEl.style.display = "none";
    }

    // 匹配度 badge
    const pct     = Math.round((result.matchRate || 0) * 100);
    const matched = result.matchedCount ?? "—";
    const total   = result.totalDims   ?? "—";
    document.getElementById("match-badge").innerHTML =
      `匹配度 ${pct}%&nbsp;&nbsp;·&nbsp;&nbsp;精准命中 ${matched}/${total} 维`;

    // 匹配度说明文字
    const noteEl = document.getElementById("match-note");
    if ((result.matchRate || 0) >= 0.7) {
      noteEl.textContent = "维度命中度较高，当前结果可视为你的第一人格画像。";
    } else if ((result.matchRate || 0) >= 0.6) {
      noteEl.textContent = "维度命中度中等，当前结果具有一定参考价值。";
    } else {
      noteEl.textContent = "维度命中度较低，结果仅供参考。";
    }

    // 人格解读
    document.getElementById("type-desc").textContent = desc;

    // 维度评分
    renderDimensions(result.tendencies || {}, dimConfig);

  }

  // ─── 维度评分渲染 ─────────────────────────────────────────────────────────
  function renderDimensions(tendencies, dimConfig) {
    const container = document.getElementById("dim-list");
    if (!dimConfig || dimConfig.length === 0) return;

    const items = dimConfig.map(dim => {
      const userVals = tendencies[dim.id] || [];
      const displayLabel = resolveDisplayLabel(userVals, dim);
      const description  = displayLabel
        ? (dim.descriptions[displayLabel] || "")
        : (dim.nullDescription || "本次测试中该维度数据不足，不纳入画像。");
      const scoreClass = displayLabel ? "dim-item-score" : "dim-item-score dim-item-score--unknown";

      return `
        <div class="dim-item">
          <div class="dim-item-top">
            <span class="dim-item-name">${dim.label}</span>
            <span class="${scoreClass}">${displayLabel || "—"}</span>
          </div>
          <p>${description}</p>
        </div>
      `;
    }).join("");

    container.innerHTML = items;
  }

  /**
   * 给定用户原始倾向值数组和维度配置，返回显示标签
   * - scale 类型：L/M/H 或 I/M/O，取众数对应的等级
   * - discrete 类型：取第一个有映射的值
   * - 多个倾向值映射到不同标签时，以第一个为准
   */
  function resolveDisplayLabel(userVals, dim) {
    if (!userVals || userVals.length === 0) return null;

    const mapped = userVals
      .map(v => dim.valueMap[v])
      .filter(Boolean);

    if (mapped.length === 0) return null;

    // 如有多个映射结果，取最高频的
    const freq = {};
    for (const v of mapped) freq[v] = (freq[v] || 0) + 1;
    const max = Math.max(...Object.values(freq));
    const topLabels = Object.keys(freq).filter(k => freq[k] === max);

    // scale 类型有级别顺序，取最中间/最高命中的
    if (dim.type === "scale" && dim.levels) {
      for (const level of dim.levels) {
        if (topLabels.includes(level)) return level;
      }
    }

    return topLabels[0];
  }

  // ─── 特殊样式 ─────────────────────────────────────────────────────────────
  function applyBodyClass(typeId) {
    document.body.dataset.type = typeId;
    if (typeId === "404" || typeId === "403") {
      document.body.classList.add("style-http-error");
    }
    if (typeId === "WIFI") {
      document.body.classList.add("style-wifi");
    }
  }

document.addEventListener("DOMContentLoaded", init);
})();
