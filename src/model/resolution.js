function dividerLines(lines) {
  const markers = [];
  let fence = '';
  let math = false;
  let comment = false;
  for (const [index, line] of lines.entries()) {
    const code = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (code && code[1][0] === fence[0] && code[1].length >= fence.length && !code[2].trim()) fence = '';
    } else if (math) {
      if (line.includes('$$')) math = false;
    } else if (comment || line.includes('<!--')) {
      for (const marker of line.match(/<!--|-->/g) ?? []) comment = marker === '<!--';
    } else if (/^ {0,3}\$\$(?!.*\$\$)/.test(line)) {
      math = true;
    } else if (code) {
      fence = code[1];
    } else if (/^ {0,3}---[ \t]*$/.test(line)) {
      markers.push(index);
    }
  }

  return markers;
}

module.exports = { dividerLines };
