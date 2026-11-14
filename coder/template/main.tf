# Coder template: one workspace = the Next app on :3000, a Typesense sidecar (indexed on start),
# and, when the LiveKit and Deepgram keys are present, the live practice-call worker from agent/.
# Shared API keys are template variables (set once by the template admin, marked sensitive);
# developers only pick a repo and branch.

terraform {
  required_providers {
    coder = {
      source = "coder/coder"
    }
    docker = {
      source = "kreuzwerker/docker"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

provider "docker" {}
provider "coder" {}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# ---- Template variables (admin-set, shared by every workspace) ---------------------------

variable "elevenlabs_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "gemini_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "google_client_id" {
  type    = string
  default = ""
}
variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "apify_token" {
  type      = string
  sensitive = true
  default   = ""
}

# Live practice calls. Leave empty and the Call tab offers the turn-by-turn browser call only.
variable "livekit_url" {
  type    = string
  default = ""
}
variable "livekit_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "livekit_api_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "deepgram_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

# ---- Workspace parameters (per developer) -----------------------------------------------

data "coder_parameter" "repo" {
  name         = "repo"
  display_name = "Repository"
  type         = "string"
  default      = "https://github.com/OfficialEseosa/scammers-view.git"
  mutable      = false
}

data "coder_parameter" "branch" {
  name         = "branch"
  display_name = "Branch"
  type         = "string"
  default      = "main"
  mutable      = true
}

# ---- Per-workspace secrets ---------------------------------------------------------------

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "typesense_key" {
  length  = 32
  special = false
}

resource "random_password" "agent_secret" {
  length  = 48
  special = false
}

locals {
  name        = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  typesense   = "${local.name}-typesense"
  live_on     = var.livekit_url != "" && var.livekit_api_key != "" && var.livekit_api_secret != "" && var.deepgram_api_key != ""
}

# ---- Agent ---------------------------------------------------------------------------------

resource "coder_agent" "main" {
  arch = "amd64"
  os   = "linux"
  dir  = "/home/coder/scammers-view"

  env = {
    ELEVENLABS_API_KEY   = var.elevenlabs_api_key
    GEMINI_API_KEY       = var.gemini_api_key
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
    APIFY_TOKEN          = var.apify_token
    AUTH_SECRET          = random_password.auth_secret.result
    AUTH_TRUST_HOST      = "true"

    TYPESENSE_HOST    = "http://${local.typesense}:8108"
    TYPESENSE_API_KEY = random_password.typesense_key.result

    LIVEKIT_URL        = var.livekit_url
    LIVEKIT_API_KEY    = var.livekit_api_key
    LIVEKIT_API_SECRET = var.livekit_api_secret
    DEEPGRAM_API_KEY   = var.deepgram_api_key
    CALL_AGENT_SECRET  = random_password.agent_secret.result
    MAX_LIVE_CALLS     = "3"
    APP_URL            = "http://localhost:3000"
  }

  startup_script = <<-EOT
    set -e
    cd /home/coder
    if [ ! -d scammers-view/.git ]; then
      git clone --branch "${data.coder_parameter.branch.value}" "${data.coder_parameter.repo.value}" scammers-view
    fi
    cd scammers-view
    npm ci --no-audit --no-fund

    # Typesense can take a few seconds to come up; the app falls back to local search meanwhile.
    for i in $(seq 1 30); do
      curl -fs "$TYPESENSE_HOST/health" >/dev/null && break
      sleep 2
    done
    npm run index:typesense || echo "Typesense indexing failed; /api/check will use local search."

    nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > /tmp/next.log 2>&1 &

    %{if local.live_on}
    (cd agent && npm ci --no-audit --no-fund && nohup npm run dev > /tmp/agent.log 2>&1 &)
    %{endif}
  EOT

  metadata {
    display_name = "Typesense"
    key          = "typesense"
    script       = "curl -fs $TYPESENSE_HOST/health >/dev/null && echo up || echo down"
    interval     = 30
    timeout      = 5
  }
}

resource "coder_app" "web" {
  agent_id     = coder_agent.main.id
  slug         = "web"
  display_name = "Scammer's View"
  url          = "http://localhost:3000"
  icon         = "/icon/globe.svg"
  subdomain    = true
  share        = "owner"

  healthcheck {
    url       = "http://localhost:3000"
    interval  = 10
    threshold = 30
  }
}

resource "coder_app" "typesense" {
  agent_id     = coder_agent.main.id
  slug         = "typesense"
  display_name = "Typesense health"
  url          = "http://${local.typesense}:8108/health"
  icon         = "/icon/database.svg"
  subdomain    = false
  share        = "owner"
}

# ---- Containers ----------------------------------------------------------------------------

resource "docker_network" "ws" {
  name = "${local.name}-net"
}

resource "docker_volume" "home" {
  name = "${local.name}-home"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_volume" "typesense" {
  name = "${local.name}-typesense"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_image" "workspace" {
  name = "${local.name}-image"
  build {
    context = path.module
  }
  triggers = {
    dockerfile = filesha1("${path.module}/Dockerfile")
  }
}

resource "docker_container" "typesense" {
  count = data.coder_workspace.me.start_count
  image = "typesense/typesense:29.0"
  name  = local.typesense
  command = [
    "--data-dir", "/data",
    "--api-key", random_password.typesense_key.result,
    "--enable-cors",
  ]
  networks_advanced {
    name = docker_network.ws.name
  }
  volumes {
    container_path = "/data"
    volume_name    = docker_volume.typesense.name
  }
}

resource "docker_container" "workspace" {
  count    = data.coder_workspace.me.start_count
  image    = docker_image.workspace.image_id
  name     = local.name
  hostname = data.coder_workspace.me.name
  user     = "coder"

  entrypoint = ["sh", "-c", replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal")]
  env        = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }
  networks_advanced {
    name = docker_network.ws.name
  }
  volumes {
    container_path = "/home/coder"
    volume_name    = docker_volume.home.name
  }
}
