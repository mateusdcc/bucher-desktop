use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use eventsource_stream::{Event, Eventsource};
use futures_util::{Stream, StreamExt};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::{redirect::Policy, Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};

const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const USAGE: &str = "https://chatgpt.com/settings/usage";
const DYNAMIC: &str = "dynamic_agent_client";
const CALLBACK: &str = "/auth/callback";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";

const SIGN_IN: &str = "Sign in to ChatGPT again in Settings → AI.";
const STORAGE: &str = "Could not access the local ChatGPT connection.";
const NETWORK: &str = "Could not reach OpenAI. Check your connection and try again.";

#[derive(Serialize, Deserialize)]
struct Registration {
    client_id: String,
    subject: String,
    email: Option<String>,
    plan_disabled: bool,
    session: Option<Session>,
}

#[derive(Serialize, Deserialize)]
struct Session {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scope: String,
}

#[derive(Serialize)]
pub struct Status {
    email: Option<String>,
    state: &'static str,
}

fn status(profile: Option<&Registration>) -> Status {
    Status {
        email: profile.and_then(|profile| profile.email.clone()),
        state: match profile {
            Some(profile) if profile.session.is_some() => "connected",
            Some(profile) if profile.plan_disabled => "plan-disabled",
            Some(_) => "signed-out",
            None => "unregistered",
        },
    }
}

fn connection_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("chatgpt"))
        .map_err(|_| STORAGE.into())
}

// Serialize writes and rotating refreshes even if two copies of Bücher are open.
fn lock(dir: &Path) -> Result<File, String> {
    fs::create_dir_all(dir).map_err(|_| STORAGE)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("connection.lock"))
        .map_err(|_| STORAGE)?;
    file.try_lock()
        .map_err(|_| "Another ChatGPT connection operation is in progress. Try again shortly.")?;
    Ok(file)
}

fn read_profile(dir: &Path) -> Result<Option<Registration>, String> {
    match fs::read(dir.join("connection.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| STORAGE.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(STORAGE.into()),
    }
}

fn private_write(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    // NamedTempFile creates owner-only files on Unix. Keep tokens out of the webview.
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|_| STORAGE)?;
    file.write_all(bytes).map_err(|_| STORAGE)?;
    file.as_file().sync_all().map_err(|_| STORAGE)?;
    file.persist(dir.join(name)).map_err(|_| STORAGE)?;
    Ok(())
}

fn save_profile(dir: &Path, profile: &Registration) -> Result<(), String> {
    let bytes = serde_json::to_vec(profile).map_err(|_| STORAGE)?;
    private_write(dir, "connection.json", &bytes)
}

fn host_id(dir: &Path) -> Result<String, String> {
    match fs::read_to_string(dir.join("host-id")) {
        Ok(id) => Ok(id),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
            private_write(dir, "host-id", id.as_bytes())?;
            Ok(id)
        }
        Err(_) => Err(STORAGE.into()),
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| NETWORK.into())
}

fn random_secret() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not initialize ChatGPT sign-in.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn callback_target(
    target: &str,
    state: &str,
    previous: Option<&str>,
) -> Option<Result<(String, String), String>> {
    if !target.starts_with("/auth/callback?") {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    let mut params = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if params.insert(key, value).is_some() {
            return None;
        }
    }
    if params.get("state").map(|value| value.as_ref()) != Some(state) {
        return None;
    }
    if params.contains_key("error") {
        return Some(Err(
            "ChatGPT sign-in was declined or did not finish. Try again from Settings.".into(),
        ));
    }
    let client = params
        .get("client_id")
        .map(|value| value.as_ref())
        .or(previous);
    Some(match (params.get("code"), client) {
        (Some(code), Some(client))
            if !code.is_empty()
                && !client.is_empty()
                && client.len() <= 200
                && client != DYNAMIC
                && client
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
                && previous.is_none_or(|previous| previous == client) =>
        {
            Ok((code.to_string(), client.to_owned()))
        }
        _ => Err("ChatGPT returned an incomplete or mismatched sign-in. Try again.".into()),
    })
}

async fn request_target(stream: &mut TcpStream) -> Option<String> {
    // Read only bounded headers. A browser preflight, probe or stalled socket cannot finish OAuth.
    let mut headers = Vec::new();
    let mut buffer = [0; 1024];
    while headers.len() < 16 * 1024 {
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            return None;
        }
        headers.extend_from_slice(&buffer[..read]);
        if headers.windows(4).any(|part| part == b"\r\n\r\n") {
            let line = std::str::from_utf8(headers.split(|byte| *byte == b'\r').next()?).ok()?;
            let mut parts = line.split_ascii_whitespace();
            return match (parts.next(), parts.next(), parts.next(), parts.next()) {
                (Some("GET"), Some(target), Some("HTTP/1.1" | "HTTP/1.0"), None) => {
                    Some(target.into())
                }
                _ => None,
            };
        }
    }
    None
}

async fn receive_callback(
    listener: TcpListener,
    state: &str,
    previous: Option<&str>,
) -> Result<(String, String), String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|_| "The local sign-in listener stopped.")?;
        let result = timeout(Duration::from_secs(2), request_target(&mut stream))
            .await
            .ok()
            .flatten()
            .and_then(|target| callback_target(&target, state, previous));
        let (status, body) = if result.as_ref().is_some_and(Result::is_ok) {
            (
                "200 OK",
                "Return to Bücher to finish connecting your ChatGPT account.",
            )
        } else if result.is_some() {
            (
                "400 Bad Request",
                "ChatGPT sign-in did not finish. Return to Bücher to try again.",
            )
        } else {
            ("404 Not Found", "No matching sign-in request.")
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = timeout(
            Duration::from_secs(1),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if let Some(result) = result {
            return result;
        }
    }
}

#[derive(Deserialize)]
struct Grant {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

impl Grant {
    fn shares_plan(&self) -> bool {
        self.scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .any(|scope| scope == PLAN_SCOPE)
    }

    fn into_session(self) -> Result<Session, String> {
        match (
            self.access_token,
            self.refresh_token,
            self.token_type,
            self.expires_in,
            self.scope,
        ) {
            (Some(access_token), Some(refresh_token), Some(kind), Some(lifetime), Some(scope))
                if kind.eq_ignore_ascii_case("bearer")
                    && !access_token.is_empty()
                    && !refresh_token.is_empty()
                    && lifetime > 0 =>
            {
                Ok(Session {
                    access_token,
                    refresh_token,
                    expires_at: now().saturating_add(lifetime),
                    scope,
                })
            }
            _ => Err("OpenAI did not return a usable ChatGPT plan session. Sign in again.".into()),
        }
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

struct OAuthError {
    message: String,
    unusable: bool,
}

async fn exchange(client: &Client, form: &[(&str, &str)]) -> Result<Grant, OAuthError> {
    let response = client
        .post(format!("{ISSUER}/api/accounts/oauth/token"))
        .form(form)
        .send()
        .await
        .map_err(|_| OAuthError {
            message: NETWORK.into(),
            unusable: false,
        })?;
    if !response.status().is_success() {
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        let unusable = matches!(
            body["error"].as_str(),
            Some(
                "invalid_grant"
                    | "invalid_refresh_token"
                    | "token_expired"
                    | "refresh_token_expired"
                    | "refresh_token_invalidated"
                    | "refresh_token_reused"
            )
        );
        return Err(OAuthError {
            message: if unusable {
                SIGN_IN.into()
            } else {
                "OpenAI could not authorize this ChatGPT connection. Try again from Settings."
                    .into()
            },
            unusable,
        });
    }
    response.json().await.map_err(|_| OAuthError {
        message: "OpenAI returned an invalid authorization response.".into(),
        unusable: false,
    })
}

#[derive(Deserialize)]
struct Identity {
    sub: String,
    email: Option<String>,
    nonce: Option<String>,
    aud: Value,
    azp: Option<String>,
}

async fn verify_identity(
    client: &Client,
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
) -> Result<Identity, String> {
    const BAD_ID: &str = "The ChatGPT identity could not be verified. Try signing in again.";
    let header = decode_header(token).map_err(|_| BAD_ID)?;
    let key_id = header.kid.ok_or(BAD_ID)?;
    let keys: JwkSet = client
        .get(format!("{ISSUER}/.well-known/jwks.json"))
        .send()
        .await
        .and_then(Response::error_for_status)
        .map_err(|_| NETWORK)?
        .json()
        .await
        .map_err(|_| BAD_ID)?;
    let key = DecodingKey::from_jwk(keys.find(&key_id).ok_or(BAD_ID)?).map_err(|_| BAD_ID)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = 5;
    let identity = decode::<Identity>(token, &key, &validation)
        .map_err(|_| BAD_ID)?
        .claims;
    if identity.sub.is_empty()
        || nonce.is_some_and(|nonce| identity.nonce.as_deref() != Some(nonce))
        || identity.azp.as_deref().is_some_and(|azp| azp != client_id)
        || (identity.aud.as_array().is_some_and(|aud| aud.len() > 1)
            && identity.azp.as_deref() != Some(client_id))
    {
        return Err(BAD_ID.into());
    }
    Ok(identity)
}

/// Return the local connection state and verified email, without exposing OAuth credentials.
#[tauri::command]
pub async fn chatgpt_status(app: AppHandle) -> Result<Status, String> {
    Ok(status(read_profile(&connection_dir(&app)?)?.as_ref()))
}

/// Open OpenAI sign-in in the system browser and verify the loopback OAuth callback before saving credentials.
#[tauri::command]
pub async fn chatgpt_login(app: AppHandle, new_account: bool) -> Result<Status, String> {
    let dir = connection_dir(&app)?;
    let _lock = lock(&dir)?;
    let previous = read_profile(&dir)?;
    if previous
        .as_ref()
        .is_some_and(|profile| profile.session.is_some())
    {
        return Err("Sign out of your current ChatGPT connection before signing in again.".into());
    }
    let previous = previous.filter(|_| !new_account);
    let registered = previous.as_ref().map(|profile| profile.client_id.as_str());
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| "Could not start the local ChatGPT sign-in listener.")?;
    let address = listener
        .local_addr()
        .map_err(|_| "Could not find the local sign-in address.")?;
    let redirect = format!("http://{address}{CALLBACK}");
    let (state, nonce, verifier) = (random_secret()?, random_secret()?, random_secret()?);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(&verifier));
    let mut url =
        Url::parse(&format!("{ISSUER}/api/accounts/authorize")).expect("constant OpenAI URL");
    url.query_pairs_mut().extend_pairs([
        ("client_id", registered.unwrap_or(DYNAMIC)),
        ("ext_agent_host_id", &host_id(&dir)?),
        ("response_type", "code"),
        ("redirect_uri", &redirect),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", &state),
        ("nonce", &nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
    ]);
    if let Some(profile) = &previous {
        if let Some(email) = &profile.email {
            url.query_pairs_mut().append_pair("login_hint", email);
        }
        if profile.plan_disabled {
            url.query_pairs_mut().append_pair("prompt", "consent");
        }
    } else {
        url.query_pairs_mut()
            .append_pair("agent_name_hint", "Bücher");
    }
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the browser for ChatGPT sign-in.")?;
    let (code, client_id) = timeout(
        Duration::from_secs(180),
        receive_callback(listener, &state, registered),
    )
    .await
    .map_err(|_| "ChatGPT sign-in timed out. Try again from Settings.")??;
    let client = client()?;
    let grant = exchange(
        &client,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("resource", RESOURCE),
        ],
    )
    .await
    .map_err(|error| error.message)?;
    let token = grant
        .id_token
        .as_deref()
        .ok_or("OpenAI did not return a ChatGPT identity.")?;
    let identity = verify_identity(&client, token, &client_id, Some(&nonce)).await?;
    if previous
        .as_ref()
        .is_some_and(|profile| profile.subject != identity.sub)
    {
        return Err(
            "This is a different ChatGPT account. Choose Use another account in Settings.".into(),
        );
    }
    let plan_disabled = !grant.shares_plan();
    let profile = Registration {
        client_id,
        subject: identity.sub,
        email: identity.email,
        plan_disabled,
        session: if plan_disabled {
            None
        } else {
            Some(grant.into_session()?)
        },
    };
    save_profile(&dir, &profile)?;
    Ok(status(Some(&profile)))
}

/// Clear Bücher's ChatGPT session, retaining the registration for the next sign-in.
#[tauri::command]
pub async fn chatgpt_logout(app: AppHandle) -> Result<(), String> {
    let dir = connection_dir(&app)?;
    let _lock = lock(&dir)?;
    if let Some(mut profile) = read_profile(&dir)? {
        let mut revoked = true;
        if let Some(session) = profile.session.take() {
            let result = client()?
                .post(format!("{ISSUER}/api/accounts/oauth/revoke"))
                .form(&[
                    ("token", session.refresh_token.as_str()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", &profile.client_id),
                ])
                .timeout(Duration::from_secs(5))
                .send()
                .await;
            revoked = result.is_ok_and(|response| response.status().is_success());
        }
        profile.plan_disabled = false;
        save_profile(&dir, &profile)?;
        if !revoked {
            return Err("Signed out of Bücher. To confirm remote disconnection, remove Bücher in ChatGPT settings.".into());
        }
    }
    Ok(())
}

async fn access_token(client: &Client, dir: &Path) -> Result<String, String> {
    let _lock = lock(dir)?;
    let mut profile = read_profile(dir)?.ok_or(SIGN_IN)?;
    let session = profile.session.as_ref().ok_or(if profile.plan_disabled {
        "Enable ChatGPT plan usage in Settings → AI before using this provider."
    } else {
        SIGN_IN
    })?;
    if session.expires_at > now().saturating_add(45) {
        return Ok(session.access_token.clone());
    }
    let grant = exchange(
        client,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &profile.client_id),
            ("refresh_token", &session.refresh_token),
            ("resource", RESOURCE),
        ],
    )
    .await
    .map(|mut grant| {
        // OAuth may omit the scope on refresh when it has not changed.
        grant.scope.get_or_insert_with(|| session.scope.clone());
        grant
    });
    match grant {
        Ok(grant) if grant.shares_plan() => {
            if let Some(id_token) = &grant.id_token {
                let identity = verify_identity(client, id_token, &profile.client_id, None).await?;
                if identity.sub != profile.subject {
                    profile.session = None;
                    save_profile(dir, &profile)?;
                    return Err(SIGN_IN.into());
                }
            }
            let session = grant.into_session()?;
            let token = session.access_token.clone();
            profile.session = Some(session);
            save_profile(dir, &profile)?;
            Ok(token)
        }
        Ok(_) => {
            profile.session = None;
            profile.plan_disabled = true;
            save_profile(dir, &profile)?;
            Err("Enable ChatGPT plan usage again in Settings → AI.".into())
        }
        Err(error) => {
            if error.unusable {
                profile.session = None;
                save_profile(dir, &profile)?;
            }
            Err(error.message)
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Model {
    slug: String,
    display_name: String,
}

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Value>,
}

/// List models available to this ChatGPT registration for the Settings picker.
#[tauri::command]
pub async fn chatgpt_models(app: AppHandle) -> Result<Vec<Model>, String> {
    let client = client()?;
    let token = access_token(&client, &connection_dir(&app)?).await?;
    let response = client
        .get(format!("{RESOURCE}/models"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| NETWORK)?;
    let catalog: Catalog = checked(response)
        .await?
        .json()
        .await
        .map_err(|_| "ChatGPT returned an invalid model list.")?;
    catalog
        .models
        .into_iter()
        .filter(|model| model["visibility"] == "list")
        .map(|model| {
            serde_json::from_value(model)
                .map_err(|_| "ChatGPT returned an incomplete model listing.".into())
        })
        .collect()
}

/// Open the official usage and app limits page in the system browser.
#[tauri::command]
pub async fn chatgpt_usage(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(USAGE, None::<&str>)
        .map_err(|_| "Could not open ChatGPT usage settings.".into())
}

fn response_error(error: &Value, status: u16) -> String {
    let code = error["code"].as_str().unwrap_or_default();
    match (code, status) {
        ("subscription_sharing_usage_limit_exceeded", _) | (_, 429) =>
            "ChatGPT usage limit reached. Open Manage usage to see your plan and app limits.".into(),
        ("subscription_sharing_user_not_eligible", _) | (_, 403) =>
            "ChatGPT plan usage is unavailable for this account, workspace or request. Check Manage usage.".into(),
        ("subscription_sharing_invalid_user", _) | (_, 401) => SIGN_IN.into(),
        ("subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable", _) | (_, 503) =>
            "ChatGPT could not check plan usage. Try again later.".into(),
        _ if matches!(error["param"].as_str(), Some("reasoning" | "reasoning.effort")) =>
            "This ChatGPT model did not accept the reasoning level. Choose Model default or another level in Settings → AI.".into(),
        ("subscription_sharing_unsupported_capability", _) =>
            "This ChatGPT model does not support this request. Choose another model in Settings → AI.".into(),
        (_, 0) => "ChatGPT could not complete the response.".into(),
        (_, status) => format!("The ChatGPT request failed (HTTP {status})."),
    }
}

async fn checked(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    Err(response_error(&body["error"], status))
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    XHigh,
    Max,
}

fn response_request(
    model: &str,
    instructions: &str,
    prompt: Value,
    schema: Option<Value>,
    reasoning_effort: Option<ReasoningEffort>,
) -> Value {
    let mut request = json!({
        "model": model,
        "instructions": instructions,
        "input": [{ "role": "user", "content": prompt.to_string() }],
        "store": false,
        "stream": true
    });
    if let Some(effort) = reasoning_effort {
        request["reasoning"] = json!({ "effort": effort });
    }
    if let Some(schema) = schema {
        request["text"] = json!({
            "format": { "type": "json_schema", "name": "bucher_result", "strict": true, "schema": schema }
        });
    }
    request
}

pub async fn generate<R: Runtime>(
    app: &AppHandle<R>,
    model: &str,
    instructions: &str,
    prompt: Value,
    schema: Option<Value>,
    reasoning_effort: Option<ReasoningEffort>,
) -> Result<String, String> {
    let client = client()?;
    let token = access_token(&client, &connection_dir(app)?).await?;
    let request = response_request(model, instructions, prompt, schema, reasoning_effort);
    let response = client
        .post(format!("{RESOURCE}/responses"))
        .bearer_auth(token)
        .timeout(Duration::from_secs(300))
        .json(&request)
        .send()
        .await
        .map_err(|_| NETWORK)?;
    let events = checked(response).await?.bytes_stream().eventsource();
    response_text(events).await
}

async fn response_text<E>(
    mut events: impl Stream<Item = Result<Event, E>> + Unpin,
) -> Result<String, String> {
    let mut text = String::new();
    while let Some(event) = events.next().await {
        let event = event.map_err(|_| "The ChatGPT response was interrupted. Try again.")?;
        let data: Value = serde_json::from_str(&event.data)
            .map_err(|_| "ChatGPT returned an invalid response.")?;
        match data["type"].as_str() {
            Some("response.output_text.delta") => {
                text.push_str(
                    data["delta"]
                        .as_str()
                        .ok_or("ChatGPT returned an invalid text response.")?,
                );
            }
            Some("response.completed") if !text.trim().is_empty() => return Ok(text),
            Some("response.completed") => {
                return Err("ChatGPT returned no text for this request.".into())
            }
            Some("response.failed" | "error") => {
                let error = [&data["response"]["error"], &data["error"]]
                    .into_iter()
                    .find(|error| error.is_object())
                    .unwrap_or(&data);
                return Err(response_error(error, 0));
            }
            Some("response.incomplete") => {
                return Err(
                    "ChatGPT stopped before completing the response. Try a shorter excerpt.".into(),
                )
            }
            _ => {}
        }
    }
    Err("The ChatGPT response ended before completion. Try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_level_is_sent_only_when_selected() {
        let default = response_request("model", "Explain", json!({}), None, None);
        assert!(default.get("reasoning").is_none());
        let effort = serde_json::from_value(json!("xhigh")).unwrap();
        let chosen = response_request("model", "Explain", json!({}), None, Some(effort));
        assert_eq!(chosen["reasoning"], json!({ "effort": "xhigh" }));
        let error = response_error(
            &json!({ "code": "unsupported_value", "param": "reasoning.effort" }),
            400,
        );
        assert!(error.contains("Model default"));
    }

    #[test]
    fn loopback_callback_ignores_a_probe_and_requires_the_right_state_and_client() {
        tauri::async_runtime::block_on(async {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tauri::async_runtime::spawn(receive_callback(
                listener,
                "secret-state",
                Some("oaiapp_fixture"),
            ));
            let client = Client::builder().no_proxy().build().unwrap();
            for path in [
                "/favicon.ico",
                "/auth/callback?state=wrong&code=untrusted",
                "/auth/callback?state=secret-state&state=duplicate&code=untrusted",
            ] {
                let result = client
                    .get(format!("http://{address}{path}"))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(result.status().as_u16(), 404);
            }
            let result = client
                .get(format!(
                    "http://{address}/auth/callback?state=secret-state&code=valid"
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(result.status().as_u16(), 200);
            assert_eq!(
                task.await.unwrap().unwrap(),
                ("valid".into(), "oaiapp_fixture".into())
            );
        });
        assert!(callback_target(
            "/auth/callback?state=secret&code=valid&client_id=oaiapp_other",
            "secret",
            Some("oaiapp_fixture")
        )
        .unwrap()
        .is_err());
        assert!(callback_target(
            "/auth/callback?state=secret&error=access_denied",
            "secret",
            None
        )
        .unwrap()
        .is_err());
    }

    #[test]
    fn only_a_granted_plan_can_provide_a_session() {
        let sign_in_only: Grant = serde_json::from_value(json!({
            "scope": "openid profile email"
        }))
        .unwrap();
        assert!(!sign_in_only.shares_plan());
        let session: Grant = serde_json::from_value(json!({
            "scope": SCOPES,
            "expires_in": 3600,
            "token_type": "Bearer",
            "access_token": "fake-access",
            "refresh_token": "fake-refresh"
        }))
        .unwrap();
        assert!(session.shares_plan());

        let dir = tempfile::tempdir().unwrap();
        let _lock = lock(dir.path()).unwrap();
        assert!(lock(dir.path()).is_err());
        assert_eq!(host_id(dir.path()).unwrap(), host_id(dir.path()).unwrap());
        let registration = Registration {
            client_id: "oaiapp_fixture".into(),
            subject: "fixture-subject".into(),
            email: Some("reader@example.com".into()),
            plan_disabled: false,
            session: Some(session.into_session().unwrap()),
        };
        save_profile(dir.path(), &registration).unwrap();
        let saved = read_profile(dir.path()).unwrap().unwrap();
        assert_eq!(
            saved.session.as_ref().unwrap().refresh_token,
            "fake-refresh"
        );
        assert_eq!(
            serde_json::to_value(status(Some(&saved))).unwrap(),
            json!({ "email": "reader@example.com", "state": "connected" })
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(dir.path().join("connection.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn only_a_completed_response_returns_text() {
        let deltas = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Linear\"}\r\n\r\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\" algebra\"}\r\n\r\n",
        );
        tauri::async_runtime::block_on(async {
            for (terminal, expected) in [
                (
                    Some(r#"{"type":"response.completed"}"#),
                    Ok("Linear algebra"),
                ),
                (None, Err("ended before completion")),
                (
                    Some(
                        r#"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}"#,
                    ),
                    Err("usage limit reached"),
                ),
            ] {
                let source = terminal
                    .map(|event| format!("{deltas}data: {event}\n\n"))
                    .unwrap_or_else(|| deltas.to_owned());
                // Split across event and JSON boundaries like an HTTP stream.
                let events = futures_util::stream::iter(
                    source.as_bytes().chunks(11).map(Ok::<_, io::Error>),
                )
                .eventsource();
                let result = response_text(events).await;
                match expected {
                    Ok(text) => assert_eq!(result.unwrap(), text),
                    Err(message) => assert!(result.unwrap_err().contains(message)),
                }
            }
        });
    }
}
