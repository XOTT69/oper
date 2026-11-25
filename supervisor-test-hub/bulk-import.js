function parseQuestionText(source) {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\uFEFF/g, '').split('\n');
  const questionMarker = /^(?:питання|запитання|question)\s*(?:№\s*)?\d*\s*[:.)-]\s*(.+)$/iu;
  const numberMarker = /^(\d{1,3})[.)]\s*(\S.*)$/u;
  const optionMarker = /^(?:[A-FАБВГҐДЕЄЖ][.)\]:]|[-–—•●▪*])\s*(\S.*)$/iu;
  const questions = [];
  let current = null;
  let gap = true;

  function start(question, number, indent) {
    current = { question, options: [], correct: [], points: 1 };
    questions.push(current);
    return { number, indent, lastOption: null };
  }

  let heading;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      gap = true;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const explicit = line.match(questionMarker);
    const numbered = line.match(numberMarker);
    const option = line.match(optionMarker);
    const number = numbered ? Number(numbered[1]) : null;
    const canStartNumberedQuestion = numbered && current && indent <= heading.indent &&
      (heading.lastOption === null || number !== heading.lastOption + 1 || numbered[2].endsWith('?'));
    const numberedHeading = canStartNumberedQuestion && (
      (heading.number !== null && number === heading.number + 1 && (current.options.length >= 2 || gap)) ||
      (gap && current.options.length >= 2)
    );

    if (!current || explicit || numberedHeading || (gap && !option && !numbered && current.options.length >= 2) ||
        (!option && !numbered && line.endsWith('?') && current.options.length >= 2)) {
      heading = start(explicit?.[1] ?? numbered?.[2] ?? line, number, indent);
    } else {
      current.options.push(option?.[1] ?? numbered?.[2] ?? line);
      heading.lastOption = number;
    }
    gap = false;
  }

  return questions;
}
