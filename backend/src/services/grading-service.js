function normalizeAnswer(value) {
  if (Array.isArray(value)) {
    return [...value].map((item) => String(item).trim()).sort();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function scoreQuestion(question, answerMap) {
  const submitted = answerMap[question.id];
  const expected = question.correct_answer;
  const marks = Number(question.marks || 0);

  if (question.question_type === "mcq") {
    return normalizeAnswer(submitted) === normalizeAnswer(expected) ? marks : 0;
  }

  if (question.question_type === "msq") {
    const left = JSON.stringify(normalizeAnswer(submitted));
    const right = JSON.stringify(normalizeAnswer(expected));
    return left === right ? marks : 0;
  }

  return 0;
}

function calculatePenalty(suspicionScore, rules) {
  const penaltyFactor = Number(rules?.penalty_per_suspicion_point ?? 0.2);
  const rawPenalty = Number(suspicionScore || 0) * penaltyFactor;
  return Number.isFinite(rawPenalty) ? Number(rawPenalty.toFixed(2)) : 0;
}

module.exports = {
  scoreQuestion,
  calculatePenalty
};
