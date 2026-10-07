import { useEffect, useRef, useState } from "react";
import { completeSignIn, NotSuperUserError } from "../auth";
import { navigate } from "../router";
import { NotSuperUser } from "./NotSuperUser";
import { SignIn } from "./SignIn";

export function Callback() {
  const [error, setError] = useState<Error>();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke: a code can be used once
    started.current = true;
    completeSignIn(new URLSearchParams(location.search))
      .then(() => navigate("/", true)) // keep the code out of history
      .catch((e: Error) => {
        history.replaceState(null, "", "/callback");
        setError(e);
      });
  }, []);
  if (error instanceof NotSuperUserError) return <NotSuperUser />;
  return error ? <SignIn error={error.message} /> : <p className="center">Signing in…</p>;
}
