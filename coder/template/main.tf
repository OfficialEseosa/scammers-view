# Coder template: one workspace = the Next app on :3000.
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

locals {
  name        = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
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
  }

  startup_script = <<-EOT
    set -e
    cd /home/coder
    if [ ! -d scammers-view/.git ]; then
      git clone --branch "${data.coder_parameter.branch.value}" "${data.coder_parameter.repo.value}" scammers-view
    fi
    cd scammers-view
    npm ci --no-audit --no-fund

    nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > /tmp/next.log 2>&1 &
  EOT
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

resource "docker_image" "workspace" {
  name = "${local.name}-image"
  build {
    context = path.module
  }
  triggers = {
    dockerfile = filesha1("${path.module}/Dockerfile")
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
