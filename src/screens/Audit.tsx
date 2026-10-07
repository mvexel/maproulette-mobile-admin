import { useEffect, useState } from "react";
import { type AuditPage, listAudit } from "../api";
import { ErrorMessage } from "./ErrorMessage";

const PAGE_SIZE = 25;

/** The backend's admin audit log, newest first. Read-only. */
export function Audit() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<AuditPage>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let current = true;
    setError(undefined);
    listAudit(page, PAGE_SIZE)
      .then((d) => current && setData(d))
      .catch((e: unknown) => current && setError(e));
    return () => {
      current = false;
    };
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <section>
      <h2>Audit log</h2>
      <p className="hint">Every admin write on the backend, newest first.</p>
      <ErrorMessage error={error} />
      {!data ? (
        !error && <p>Loading…</p>
      ) : (
        <>
          <Pager page={page} pages={pages} total={data.total} onPage={setPage} />
          <table>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} data-testid="audit-row">
                  <td>{e.createdAt.replace("T", " ").replace(/\.\d+Z$|Z$/, "")}</td>
                  <td>{e.actorUserId}</td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td>
                    <code>{e.target}</code>
                  </td>
                  <td>
                    {(e.before !== undefined || e.after !== undefined) && (
                      <details>
                        <summary>Show</summary>
                        {e.before !== undefined && (
                          <>
                            <div className="hint">Before</div>
                            <pre>{JSON.stringify(e.before, null, 2)}</pre>
                          </>
                        )}
                        {e.after !== undefined && (
                          <>
                            <div className="hint">After</div>
                            <pre>{JSON.stringify(e.after, null, 2)}</pre>
                          </>
                        )}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && <p>No entries.</p>}
        </>
      )}
    </section>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <p className="pager">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Newer
      </button>
      <span data-testid="audit-page">
        Page {page + 1} of {pages} ({total} entries)
      </span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        Older
      </button>
    </p>
  );
}
