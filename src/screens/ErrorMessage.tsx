import { describeError } from "../api";

/** An error with the backend's validation details, if any. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (error === undefined) return null;
  const { message, detail } = describeError(error);
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {detail.length > 0 && (
        <ul>
          {detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
