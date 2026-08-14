import { AccountNode, flattenAccounts } from "../api";

interface Props {
  tree: AccountNode[];
  value: number | "";
  onChange: (id: number | "") => void;
  filterType?: AccountNode["type"][];
  excludeId?: number;
  placeholder?: string;
  style?: React.CSSProperties;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export default function AccountSelect({
  tree,
  value,
  onChange,
  filterType,
  excludeId,
  placeholder,
  style,
  allowEmpty,
  emptyLabel,
}: Props) {
  const flat = flattenAccounts(tree).filter(
    (entry) => (filterType ? filterType.includes(entry.node.type) : true) && entry.node.id !== excludeId
  );
  const selectedName = value !== "" ? flat.find((entry) => entry.node.id === value)?.node.name : undefined;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      style={style}
      title={selectedName}
    >
      <option value="" disabled={!allowEmpty}>
        {value === "" || !allowEmpty ? placeholder ?? "Konto wählen" : emptyLabel ?? "Keine Zuordnung"}
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
