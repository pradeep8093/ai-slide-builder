import { isDarkColor } from "@/lib/color";
import type { TableElement } from "@/lib/schema";

/** Table rendering shared by the editor, thumbnails, present mode and exports. Rows share the height evenly. */
export default function TableView({ element }: { element: TableElement }) {
  const { rows, headerRow, headerFill, borderColor, fontSize, fontFamily, color } = element;
  const border = borderColor ? `1.5px solid ${borderColor}` : "none";
  const headerColor = headerFill && isDarkColor(headerFill) ? "#ffffff" : color;
  return (
    <table
      data-element-type="table"
      style={{
        width: "100%",
        height: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontFamily,
        fontSize,
        color,
        lineHeight: 1.2,
      }}
    >
      <tbody>
        {rows.map((row, ri) => {
          const isHeader = headerRow && ri === 0;
          return (
            <tr key={ri} style={{ height: `${100 / rows.length}%` }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    border,
                    padding: `${Math.round(fontSize * 0.25)}px ${Math.round(fontSize * 0.45)}px`,
                    background: isHeader && headerFill ? headerFill : undefined,
                    color: isHeader ? headerColor : color,
                    fontWeight: isHeader ? 700 : 400,
                    verticalAlign: "middle",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                    overflow: "hidden",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
