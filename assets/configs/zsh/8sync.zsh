# Managed by 8sync (`8sync forge`, `8sync setup --profile terminal`) — rewritten on update.
# Personal settings belong in ~/.zshrc. Nothing below forks per keystroke or per
# prompt: on Windows (MSYS) every fork costs ~10–25 ms, which is what makes a
# shell feel sticky.
[[ -n $_8s_loaded ]] && return
_8s_loaded=1
[[ -z "$TERM" || "$TERM" == dumb ]] && export TERM=xterm-256color
zmodload zsh/datetime zsh/complist 2>/dev/null

# ── history · navigation ────────────────────────────────────────────────────
: ${HISTFILE:=$HOME/.zsh_history}
HISTSIZE=50000 SAVEHIST=50000
setopt interactive_comments prompt_subst share_history extended_history hist_ignore_all_dups \
  hist_ignore_space hist_reduce_blanks hist_verify auto_cd auto_pushd pushd_ignore_dups \
  pushd_silent complete_in_word no_beep
WORDCHARS=${WORDCHARS//[\/=.]}

# ── completion: arrow-key menu, case-insensitive, dump rebuilt at most daily ─
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit
  () {
    setopt local_options extended_glob
    local dump=${ZDOTDIR:-$HOME}/.zcompdump
    if [[ -f $dump && -z $dump(#qN.mh+20) ]]; then compinit -C -d $dump; else compinit -u -d $dump; fi
  }
fi
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*:default' list-colors ${(s.:.)LS_COLORS} 'di=1;34' 'ln=36' 'ex=32'
zstyle ':completion:*' group-name ''
zstyle ':completion:*:descriptions' format '%F{8}── %d%f'
zstyle ':completion:*' squeeze-slashes true
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "${ZDOTDIR:-$HOME}/.zcompcache"

# ── keys: Windows Terminal / xterm / kitty sequences, ↑↓ search by prefix ───
bindkey -e
autoload -Uz up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
() {
  local -A keys=(
    '^[[A' up-line-or-beginning-search   '^[OA' up-line-or-beginning-search
    '^[[B' down-line-or-beginning-search '^[OB' down-line-or-beginning-search
    '^[[H' beginning-of-line '^[OH' beginning-of-line '^[[1~' beginning-of-line
    '^[[F' end-of-line       '^[OF' end-of-line       '^[[4~' end-of-line
    '^[[3~' delete-char      '^[[3;5~' kill-word
    '^[[1;5C' forward-word   '^[[1;5D' backward-word
    '^[[1;3C' forward-word   '^[[1;3D' backward-word
  )
  local k; for k in ${(k)keys}; do bindkey $k $keys[$k]; done
}
[[ ${terminfo[kbs]} == $'\b' ]] || bindkey '^H' backward-kill-word   # Ctrl+Backspace
bindkey -M menuselect '^[[Z' reverse-menu-complete                   # Shift+Tab

# ── colours ─────────────────────────────────────────────────────────────────
if [[ $OSTYPE == darwin* ]]; then export CLICOLOR=1; else (( $+aliases[ls] )) || alias ls='ls --color=auto'; fi
(( $+aliases[ll] )) || alias ll='ls -lAh'
(( $+aliases[grep] )) || alias grep='grep --color=auto'

# ── Forge integration (only inside `8sync forge <name>`) ────────────────────
# Forge stamps each command with `$(date +%s)` — a fork per command. Same value, no fork.
(( $+functions[_forge_context_preexec] )) &&
  functions[_forge_context_preexec]=${functions[_forge_context_preexec]//'$(date +%s)'/'$EPOCHSECONDS'}

# ── prompt ──────────────────────────────────────────────────────────────────
#   su-code/crates on main · core  FORGE 48.5k claude-opus-5-5 MEDIUM 3.2s
#   ❯
typeset -g _8s_root= _8s_git= _8s_dir= _8s_took= _8s_t0= _8s_cmd= _8s_drawn=
typeset -g _8s_forge= _8s_fd= _8s_forge_at=0 _8s_cols=
_8s_vcs() {   # repo root + branch straight from .git/HEAD: no git process per prompt
  local d=$PWD g line
  _8s_root= _8s_git=
  while [[ ! -e $d/.git ]]; do [[ $d == / ]] && return; d=${d:h}; done
  _8s_root=$d g=$d/.git
  if [[ -f $g ]]; then   # worktree / submodule: `gitdir: <path>`
    read -r line < $g; g=${line#gitdir: }
    [[ $g == [A-Za-z]:* ]] && g=/${(L)g[1]}${g[3,-1]}
    [[ $g == /* ]] || g=$d/$g
  fi
  [[ -r $g/HEAD ]] && read -r line < $g/HEAD || return
  if [[ $line == ref:* ]]; then _8s_git=${line#ref: refs/heads/}; else _8s_git=${line[1,7]}; fi
}
_8s_where() {  # repo-relative inside a repo, else the last three path parts
  if [[ -n $_8s_root ]]; then
    local rel=${PWD#${(b)_8s_root}}
    _8s_dir="%B%F{blue}${${_8s_root:t}//\%/%%}%b${rel//\%/%%}%f"
  else
    _8s_dir='%B%F{blue}%(4~|…/%3~|%~)%b%f'
  fi
}
_8s_forge_done() {   # zle -F widget: Forge's agent · tokens · model segment arrived
  local fd=$1 out
  IFS= read -r -d '' -u $fd out
  zle -F $fd; exec {fd}<&-
  _8s_fd=
  out=${out%$'\n'}
  if [[ $out != $_8s_forge ]]; then _8s_forge=$out; zle reset-prompt; zle -R; fi
}
zle -N _8s_forge_done
_8s_forge_refresh() {   # async: the prompt never waits for `forge`
  (( $+functions[_forge_prompt_info] )) || return
  if [[ -n $_8s_fd ]]; then zle -F $_8s_fd 2>/dev/null; exec {_8s_fd}<&-; fi
  _8s_forge_at=$EPOCHSECONDS _8s_cols=$COLUMNS
  exec {_8s_fd}< <(_forge_prompt_info)
  zle -F -w $_8s_fd _8s_forge_done
}
_8s_preexec() { _8s_t0=$EPOCHREALTIME _8s_cmd=$1 }
_8s_precmd() {
  _8s_took=
  if [[ -n $_8s_t0 ]]; then
    local -F s=$(( EPOCHREALTIME - _8s_t0 )); local -i si=$s
    if (( si >= 60 )); then _8s_took="$(( si / 60 ))m$(( si % 60 ))s"
    elif (( s >= 2 )); then printf -v _8s_took '%.1fs' $s; fi
    _8s_t0=
  fi
  _8s_vcs; _8s_where
  print -Pn "\e]0;%1~${EIGHTSYNC_FORGE_SESSION:+ · forge:$EIGHTSYNC_FORGE_SESSION}\a"
  [[ -n $_8s_drawn ]] && print; _8s_drawn=1
  # Forge's segment only changes through Forge: refresh after a forge command,
  # on resize, or every 30 s — not after every `ls`.
  if [[ -z $_8s_forge || $_8s_cmd == *forge* || $COLUMNS != $_8s_cols ]] || (( EPOCHSECONDS - _8s_forge_at > 30 )); then
    _8s_forge_refresh
  fi
  _8s_cmd=
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec _8s_preexec
add-zsh-hook precmd _8s_precmd
# Numeric colours (`%8F`): a `}` from `%F{8}` would close the `${var:+…}` around it.
PROMPT='${_8s_dir}${_8s_git:+ %8Fon%f %5F${_8s_git//\%/%%}%f}${EIGHTSYNC_FORGE_SESSION:+ %8F·%f %6F${EIGHTSYNC_FORGE_SESSION}%f}${_8s_forge}${_8s_took:+ %3F${_8s_took}%f}
%(?.%2F.%1F)❯%f '
RPROMPT=''

# `:` commands run inside Forge's widget and never reach precmd: refresh after them.
if (( $+widgets[forge-accept-line] )); then
  _8s-accept-line() {
    if [[ $BUFFER == :* ]]; then zle forge-accept-line; _8s_forge_refresh; else zle forge-accept-line; fi
  }
  zle -N _8s-accept-line
  bindkey '^M' _8s-accept-line
  bindkey '^J' _8s-accept-line
fi

# ── plugins: fish-style suggestions, then syntax highlighting (must be last) ─
# Sourced at top level, not inside a function: both plugins declare globals.
_8s_plug=${EIGHTSYNC_ZSH_PLUGINS:-/nonexistent}
if [[ -r $_8s_plug/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && (( ! $+functions[_zsh_autosuggest_start] )); then
  ZSH_AUTOSUGGEST_STRATEGY=(history)
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=8'
  ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=200
  ZSH_AUTOSUGGEST_MANUAL_REBIND=1
  source $_8s_plug/zsh-autosuggestions/zsh-autosuggestions.zsh
  unset ZSH_AUTOSUGGEST_USE_ASYNC   # async forks per keystroke; history lookup is instant anyway
  ZSH_AUTOSUGGEST_CLEAR_WIDGETS+=(_8s-accept-line forge-accept-line)
fi
if [[ -r $_8s_plug/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]] && (( ! $+functions[_zsh_highlight] )); then
  ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets pattern)   # pattern = Forge's `:cmd` / `@[file]` rules
  ZSH_HIGHLIGHT_MAXLENGTH=300
  source $_8s_plug/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
  ZSH_HIGHLIGHT_STYLES[comment]='fg=8'
fi
unset _8s_plug
