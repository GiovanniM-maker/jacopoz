import { StyleProp, Text, TextStyle } from "react-native";

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

type Span = { text: string; bold: boolean; italic: boolean };

/**
 * Renders review/comment bodies with the tiny markdown subset our composer
 * writes: **grassetto** and *corsivo* / _corsivo_. Anything else is shown
 * verbatim. Pairing is positional (like markdown) so the toolbar's balanced
 * markers always render, and stray markers degrade gracefully.
 */
export function RichText({ text, style, numberOfLines }: Props) {
  const spans = parse(text ?? "");
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {spans.map((s, i) => (
        <Text
          key={i}
          style={{
            fontWeight: s.bold ? "800" : undefined,
            fontStyle: s.italic ? "italic" : undefined,
          }}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

function parse(text: string): Span[] {
  const out: Span[] = [];
  // Bold delimiters first (**…**): even segments are normal, odd are bold.
  text.split("**").forEach((boldPart, bi) => {
    const bold = bi % 2 === 1;
    // Then italic (* or _): even normal, odd italic.
    boldPart.split(/[*_]/).forEach((itPart, ii) => {
      if (itPart === "") return;
      out.push({ text: itPart, bold, italic: ii % 2 === 1 });
    });
  });
  return out.length ? out : [{ text, bold: false, italic: false }];
}
