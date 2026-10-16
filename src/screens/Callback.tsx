import { useEffect, useRef, useState } from "react";
import { completeSignIn, NotSetUpError } from "../auth";
import { navigate } from "../router";
import { NotSetUp } from "./NotSetUp";
import { SignIn } from "./SignIn";

export function Callback() {
  const [error, setError] = useState<Error>();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke: a code can be used once
    started.current = true;
    completeSignIn(new URLSearchParams(location.search))
      // "retrying": the browser is on its way to ask for the organizer grant.
      .then((done) => done === "signed-in" && navigate("/", true)) // keep the code out of history
      .catch((e: Error) => {
        history.replaceState(null, "", "/callback");
        setError(e);
      });
  }, []);
  if (error instanceof NotSetUpError) return <NotSetUp />;
  return error ? <SignIn error={error.message} /> : <p className="center">Signing in…</p>;
}
