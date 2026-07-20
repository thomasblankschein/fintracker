import { AccountNode, flattenAccounts } from "../api";

interface Props {
  tree: AccountNode[];
  value: number | "";
  onChange: (id: number) => void;
  filterType?: AccountNode["type"][];
  placeholder?: string;
}

export default function AccountSelect({ tree, value, onChange, filterType, placeholder }: Props) {
  const flat = flattenAccounts(tree).filter((entry) =>
    filterType ? filterType.includes(entry.node.type) : true
  );

  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="" disabled>
        {placeholder ?? "Konto wählen"}
      </option>
      {flat.map(({ node, depth }) => (
        <option key={node.id} value={node.id} disabled={!node.isActive}>
          {"  ".repeat(depth)}
          {node.name}
        </option>
      ))}
    </select>
  );
}
