//! 只覆盖 Skill 用得到的 YAML 子集：顶层 `key: value`、引号、`|` / `>` 块。
//! 不引入完整 YAML 依赖；没有 frontmatter 时整个文件就是正文。

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Plain,
    Block,
}

pub fn parse(raw: &str) -> (Vec<(String, String)>, String) {
    let lines: Vec<&str> = raw.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return (vec![], raw.to_string());
    }
    let end = match lines.iter().enumerate().skip(1).find(|(_, l)| l.trim() == "---") {
        Some((i, _)) => i,
        None => return (vec![], raw.to_string()),
    };

    let mut fields: Vec<(String, String)> = Vec::new();
    let mut key: Option<String> = None;
    let mut kind = Kind::Plain;
    let mut value = String::new();

    let flush = |fields: &mut Vec<(String, String)>, key: &mut Option<String>, kind: Kind, value: &mut String| {
        if let Some(k) = key.take() {
            let v = match kind {
                Kind::Plain => value.trim().to_string(),
                Kind::Block => value.split_whitespace().collect::<Vec<_>>().join(" "),
            };
            fields.push((k, v));
        }
        value.clear();
    };

    for line in &lines[1..end] {
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if !indented {
            flush(&mut fields, &mut key, kind, &mut value);
            kind = Kind::Plain;
            let Some((k, v)) = line.split_once(':') else { continue };
            key = Some(k.trim().to_string());
            let v = v.trim();
            if matches!(v, "|" | ">" | "|-" | ">-" | "|+" | ">+") {
                kind = Kind::Block;
            } else {
                value.push_str(&unquote(v));
            }
        } else if key.is_some() {
            value.push_str(line.trim_start());
            value.push('\n');
        }
    }
    flush(&mut fields, &mut key, kind, &mut value);

    let body = lines[end + 1..].join("\n");
    (fields, body.trim_start_matches('\n').to_string())
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    let quoted = v.len() >= 2
        && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')));
    if quoted {
        v[1..v.len() - 1].to_string()
    } else {
        v.to_string()
    }
}

pub fn build(name: &str, description: &str, body: &str) -> String {
    let one_line = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("---\nname: {}\ndescription: {}\n---\n\n{}\n", name.trim(), one_line(description), body.trim_end())
}
