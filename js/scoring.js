/**
 * scoring.js — NBTI 核心算法
 *
 * 主流程：
 *   用户答案 → 统计各维度倾向 → 与18个类型档案做相似度匹配
 *   → 最高匹配度 ≥ 60% → 输出对应类型
 *   → 最高匹配度 < 60% → 检查 EB-04 → B → USAGI，其他 → FREE
 *
 * 特殊权重规则（DAMN）：
 *   不认同选项（disapproval:true）累计 ≥ 10 且 CA 倾向包含「直接」
 *   → DAMN 匹配分 +0.15
 */

const NBTI = (function () {

  // ─── 常量 ────────────────────────────────────────────────────────────────
  const MATCH_THRESHOLD       = 0.60;
  const DAMN_DISAPPROVAL_N    = 10;
  const DAMN_BONUS            = 0.15;

  // CA 维度「直接」类标签集合（用于判断 DAMN 特殊权重）
  const CA_DIRECT_LABELS = new Set(["直接"]);

  // ─── 公开 API ─────────────────────────────────────────────────────────────

  /**
   * 主入口
   * @param {Object} answers      { questionId: optionId, … }
   * @param {Array}  questions    questions.json 的 questions 数组
   * @param {Array}  types        types.json 的 types 数组
   * @returns {Object} { typeId, matchRate, matchedCount, totalDims, tendencies, allScores }
   */
  function calculate(answers, questions, types) {
    // 1. 统计各维度倾向
    const tendencies = getDimensionTendencies(answers, questions);

    // 2. 统计不认同数（DAMN 特殊权重）
    const disapprovalCount = countDisapproval(answers, questions);

    // 3. 计算 18 个正式类型的匹配分
    const normalTypes = types.filter(t => !t.special);
    const allScores = normalTypes.map(type => {
      let rate = matchType(tendencies, type.profile);

      // DAMN 特殊权重
      if (
        type.specialWeight &&
        disapprovalCount >= DAMN_DISAPPROVAL_N &&
        tendencies.CA &&
        hasIntersection(tendencies.CA, CA_DIRECT_LABELS)
      ) {
        rate = Math.min(1, rate + DAMN_BONUS);
      }

      return { typeId: type.id, matchRate: rate };
    });

    // 按匹配分降序，相同分优先取有效维度数更多的
    allScores.sort((a, b) => {
      if (Math.abs(a.matchRate - b.matchRate) > 1e-9) return b.matchRate - a.matchRate;
      // 同分：有效维度数多的更可靠
      const dimA = countMatchableDims(types.find(t => t.id === a.typeId).profile);
      const dimB = countMatchableDims(types.find(t => t.id === b.typeId).profile);
      return dimB - dimA;
    });

    const best = allScores[0];

    // 4. 计算最佳类型的命中维度数
    const bestType = types.find(t => t.id === best.typeId);
    const { matched: matchedCount, total: totalDims } = matchTypeCounted(tendencies, bestType ? bestType.profile : {});

    // 5. 将 tendencies Set 序列化为普通数组（方便 sessionStorage 存储）
    const tendenciesPlain = {};
    for (const [dim, set] of Object.entries(tendencies)) {
      tendenciesPlain[dim] = [...set];
    }

    // 6. 阈值判断
    if (best.matchRate >= MATCH_THRESHOLD) {
      return { typeId: best.typeId, matchRate: best.matchRate, matchedCount, totalDims, tendencies: tendenciesPlain, allScores };
    }

    // 7. 兜底逻辑：检查 EB-04 答案
    const eb04Answer = answers["EB-04"];
    const eb04Question = questions.find(q => q.id === "EB-04");
    const eb04Option = eb04Question
      ? eb04Question.options.find(o => o.id === eb04Answer)
      : null;

    if (eb04Option && eb04Option.usagiTrigger) {
      return { typeId: "USAGI", matchRate: best.matchRate, matchedCount, totalDims, tendencies: tendenciesPlain, allScores };
    }
    return { typeId: "FREE", matchRate: best.matchRate, matchedCount, totalDims, tendencies: tendenciesPlain, allScores };
  }

  // ─── 内部函数 ─────────────────────────────────────────────────────────────

  /**
   * 统计各维度倾向
   * 返回 Map<dimension, Set<canonicalValue>>
   * - 频次最高的值（们）入 Set
   * - 如有平局，多个值都入 Set（匹配时任一命中即算）
   */
  function getDimensionTendencies(answers, questions) {
    const DIMENSIONS = ["DR", "PR", "CA", "RC", "SC", "RS", "EB"];
    const freq = {};   // { dim: { value: count } }
    DIMENSIONS.forEach(d => { freq[d] = {}; });

    for (const [qId, optId] of Object.entries(answers)) {
      const question = questions.find(q => q.id === qId);
      if (!question) continue;
      const option = question.options.find(o => o.id === optId);
      if (!option || !option.score) continue;

      for (const [dim, val] of Object.entries(option.score)) {
        if (!val) continue;
        freq[dim][val] = (freq[dim][val] || 0) + 1;
      }
    }

    const tendencies = {};
    for (const dim of DIMENSIONS) {
      const counts = freq[dim];
      if (!counts || Object.keys(counts).length === 0) continue;

      const maxCount = Math.max(...Object.values(counts));
      // 取所有并列最高值
      const topValues = Object.entries(counts)
        .filter(([, c]) => c === maxCount)
        .map(([v]) => v);
      tendencies[dim] = new Set(topValues);
    }
    return tendencies;
  }

  /**
   * 计算用户倾向与类型档案的匹配率
   * matchRate = 命中维度数 / 有效（可匹配）维度数
   *
   * profile 格式：
   *   { DR: ["内"], CA: ["化解", "回避"], EB: null, … }
   * - null → 该维度跳过（不参与分母）
   * - 数组 → OR 逻辑，用户倾向集合与数组有交集即算命中
   */
  function matchType(tendencies, profile) {
    let total   = 0;
    let matched = 0;

    for (const [dim, profileVals] of Object.entries(profile)) {
      if (!profileVals) continue;          // null → 跳过
      total++;

      const userSet = tendencies[dim];
      if (!userSet || userSet.size === 0) continue; // 用户该维度无数据

      // OR 逻辑：档案值中任一在用户倾向集合里即命中
      if (hasIntersection(userSet, new Set(profileVals))) {
        matched++;
      }
    }

    if (total === 0) return 0;
    return matched / total;
  }

  /**
   * matchType 的计数版本，返回 { matched, total }
   */
  function matchTypeCounted(tendencies, profile) {
    let total   = 0;
    let matched = 0;
    for (const [dim, profileVals] of Object.entries(profile)) {
      if (!profileVals) continue;
      total++;
      const userSet = tendencies[dim];
      if (!userSet || userSet.size === 0) continue;
      if (hasIntersection(userSet, new Set(profileVals))) matched++;
    }
    return { matched, total };
  }

  /**
   * 统计用户答案中 disapproval:true 的选项数量
   */
  function countDisapproval(answers, questions) {
    let count = 0;
    for (const [qId, optId] of Object.entries(answers)) {
      const question = questions.find(q => q.id === qId);
      if (!question) continue;
      const option = question.options.find(o => o.id === optId);
      if (option && option.disapproval === true) count++;
    }
    return count;
  }

  /**
   * 统计类型档案的可匹配维度数（非 null 的维度数）
   */
  function countMatchableDims(profile) {
    return Object.values(profile).filter(v => v !== null).length;
  }

  /**
   * 判断两个 Set 是否有交集
   */
  function hasIntersection(setA, setB) {
    for (const v of setA) {
      if (setB.has(v)) return true;
    }
    return false;
  }

  // ─── 调试工具 ─────────────────────────────────────────────────────────────

  /**
   * 返回详细的维度倾向信息（供调试面板使用）
   */
  function debugTendencies(answers, questions) {
    const tendencies = getDimensionTendencies(answers, questions);
    const result = {};
    for (const [dim, set] of Object.entries(tendencies)) {
      result[dim] = [...set];
    }
    result._disapproval = countDisapproval(answers, questions);
    return result;
  }

  return { calculate, debugTendencies };

})();

// 兼容 Node.js 环境（用于单元测试）
if (typeof module !== "undefined" && module.exports) {
  module.exports = NBTI;
}
