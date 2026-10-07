import { useCallback, useEffect, useState } from "react";
import { type Client, createClient, listClients, updateClient } from "../api";
import { config } from "../config";
import { ErrorMessage } from "./ErrorMessage";

const SCOPE_SETS = [
  ["tasks:read"],
  ["tasks:read", "tasks:write"],
  ["tasks:read", "tasks:write", "osm:tagfix"],
  ["mobile:admin"],
];

export function Clients() {
  const [clients, setClients] = useState<Client[]>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<Client | "new">();
  const [disabling, setDisabling] = useState<Client>();

  const reload = useCallback(() => {
    listClients()
      .then(setClients)
      .catch((e: unknown) => setError(e));
  }, []);
  useEffect(reload, [reload]);

  const act = async (work: () => Promise<string | undefined>) => {
    setError(undefined);
    setNotice(undefined);
    try {
      setNotice(await work());
      reload();
    } catch (e) {
      setError(e);
    }
  };

  const enable = (c: Client) =>
    act(async () => {
      await updateClient(c.id, { enabled: true });
      return `Enabled ${c.id}.`;
    });

  return (
    <section>
      <h2>
        Clients{" "}
        <button type="button" onClick={() => setEditing("new")}>
          Add client
        </button>
      </h2>
      <p className="hint">
        Mobile apps (and this admin app) that may sign in through <code>{config().backend}</code>.
      </p>
      <ErrorMessage error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {editing && (
        <ClientForm
          key={editing === "new" ? "new" : editing.id}
          client={editing === "new" ? undefined : editing}
          onDone={(message) => {
            setEditing(undefined);
            setNotice(message);
            reload();
          }}
          onCancel={() => setEditing(undefined)}
        />
      )}
      {disabling && (
        <DisableDialog
          client={disabling}
          onCancel={() => setDisabling(undefined)}
          onConfirm={(revoke) => {
            setDisabling(undefined);
            void act(async () => {
              const r = await updateClient(disabling.id, { enabled: false }, revoke);
              return revoke
                ? `Disabled ${disabling.id} and revoked ${r.revokedGrantFamilies ?? 0} sign-in(s).`
                : `Disabled ${disabling.id}.`;
            });
          }}
        />
      )}
      {!clients ? (
        !error && <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Redirects</th>
              <th>Scopes</th>
              <th>Enabled</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className={c.enabled ? "" : "disabled"} data-testid={`client-${c.id}`}>
                <td>
                  <code>{c.id}</code>
                  {c.id === config().clientId && <div className="hint">this app</div>}
                </td>
                <td>{c.name}</td>
                <td>
                  {c.redirectUris.map((u) => (
                    <div key={u}>
                      <code>{u}</code>
                    </div>
                  ))}
                </td>
                <td>{c.scopes.join(" ")}</td>
                <td>{c.enabled ? "yes" : "no"}</td>
                <td>{c.source}</td>
                <td className="actions">
                  <button type="button" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  {c.enabled ? (
                    <button type="button" onClick={() => setDisabling(c)}>
                      Disable
                    </button>
                  ) : (
                    <button type="button" onClick={() => void enable(c)}>
                      Enable
                    </button>
                  )}
                  {c.enabled && !c.scopes.includes("mobile:admin") && <SdkSnippet id={c.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SdkSnippet({ id }: { id: string }) {
  const text = `backend: ${config().backend}\nclientId: ${id}`;
  return (
    <button type="button" title={text} onClick={() => void navigator.clipboard.writeText(text)}>
      Copy SDK config
    </button>
  );
}

function DisableDialog({
  client,
  onCancel,
  onConfirm,
}: {
  client: Client;
  onCancel: () => void;
  onConfirm: (revoke: boolean) => void;
}) {
  const [revoke, setRevoke] = useState(false);
  return (
    <div className="panel" role="dialog" aria-label={`Disable ${client.id}`}>
      <p>
        Disable <code>{client.id}</code>? It can no longer sign in, refresh or use its tokens, within 10
        seconds on every backend process. Its sign-ins are kept, so enabling it again restores them.
      </p>
      <label className="inline">
        <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
        Also revoke all its sign-ins. Users must sign in again; this cannot be undone.
      </label>
      <p>
        <button type="button" onClick={() => onConfirm(revoke)}>
          Disable
        </button>{" "}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  );
}

function ClientForm({
  client,
  onDone,
  onCancel,
}: {
  client?: Client;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(client?.id ?? "");
  const [name, setName] = useState(client?.name ?? "");
  const [redirects, setRedirects] = useState(client?.redirectUris.join("\n") ?? "");
  const [scopes, setScopes] = useState(client?.scopes.join(" ") ?? SCOPE_SETS[0].join(" "));
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    const redirectUris = redirects
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (client) {
        // Send only what changed: unchanged values (for example a loopback redirect that came
        // from config) are not re-validated.
        const patch: Parameters<typeof updateClient>[1] = {};
        if (name !== client.name) patch.name = name;
        if (redirectUris.join("\n") !== client.redirectUris.join("\n")) patch.redirectUris = redirectUris;
        if (scopes !== client.scopes.join(" ")) patch.scopes = scopes.split(" ");
        if (Object.keys(patch).length === 0) {
          onDone(`Nothing to change for ${client.id}.`);
          return;
        }
        await updateClient(client.id, patch);
        onDone(`Saved ${client.id}.`);
      } else {
        await createClient({ id, name, redirectUris, scopes: scopes.split(" "), enabled: true });
        onDone(`Created ${id}.`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} aria-label={client ? `Edit ${client.id}` : "New client"}>
      <h3>{client ? `Edit ${client.id}` : "New client"}</h3>
      <label>
        ID
        <input value={id} onChange={(e) => setId(e.target.value)} disabled={!!client} required />
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Redirect URIs (one per line)
        <textarea value={redirects} onChange={(e) => setRedirects(e.target.value)} rows={3} required />
      </label>
      <label>
        Scopes
        <select value={scopes} onChange={(e) => setScopes(e.target.value)}>
          {SCOPE_SETS.map((s) => (
            <option key={s.join(" ")} value={s.join(" ")}>
              {s.join(" ")}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={error} />
      <p>
        <button type="submit" disabled={busy}>
          {client ? "Save" : "Create"}
        </button>{" "}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
