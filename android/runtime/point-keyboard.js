/* Compact point-entry keyboard. Values remain unsaved drafts until the user presses Save. */
document.addEventListener('DOMContentLoaded',()=>{
  const selector='#pointsBody input[data-k="point_name"]';
  let target=null,mode='letters';
  const panel=document.createElement('section');
  panel.id='pointKeyboard';panel.hidden=true;panel.setAttribute('aria-label','设备点位键盘');
  panel.innerHTML='<div class="point-keyboard-toolbar"><strong>设备点位 <span id="pointKeyboardValue"></span></strong><div>'+[
    ['letters','ABC'],['numbers','123'],['backspace','退格'],['clear','清空'],['next','下一行'],['done','收起']
  ].map(([action,label])=>`<button type="button" data-action="${action}">${label}</button>`).join('')+'</div></div><div id="pointKeyboardKeys"></div>';
  document.body.append(panel);
  const keys=panel.querySelector('#pointKeyboardKeys'),preview=panel.querySelector('#pointKeyboardValue');
  function reserve(){
    document.documentElement.style.setProperty('--point-keyboard-height',panel.hidden?'0px':panel.offsetHeight+'px');
  }
  function render(){
    const rows=mode==='letters'?['QWERTYUIOP','ASDFGHJKL','ZXCVBNM']:['1234567890'];
    keys.innerHTML=rows.map(row=>'<div class="point-keyboard-row">'+Array.from(row).map(key=>`<button type="button" data-key="${key}">${key}</button>`).join('')+'</div>').join('');
    panel.querySelectorAll('[data-action="letters"],[data-action="numbers"]').forEach(button=>button.classList.toggle('selected',button.dataset.action===mode));
    preview.textContent=target?.value||'先填字母，再填编号';reserve();
  }
  function open(input){
    const different=target!==input;
    target=input;input.readOnly=true;input.inputMode='none';
    mode=/^[A-Z]/i.test(input.value)?'numbers':'letters';
    panel.hidden=false;document.body.classList.add('point-keyboard-open');
    NativeStore.pointKeyboard(3);render();
    if(different)requestAnimationFrame(()=>input.scrollIntoView({block:'center',inline:'nearest'}));
  }
  function close(){
    target=null;panel.hidden=true;document.body.classList.remove('point-keyboard-open');reserve();NativeStore.pointKeyboard(0);
  }
  function write(value,start){
    if(!target?.isConnected)return close();
    target.value=value.toUpperCase().slice(0,target.maxLength>0?target.maxLength:32);
    target.setSelectionRange(Math.min(start,target.value.length),Math.min(start,target.value.length));
    target.dispatchEvent(new Event('input',{bubbles:true}));
    mode=/^[A-Z]/.test(target.value)?'numbers':'letters';render();
    requestAnimationFrame(()=>target?.scrollIntoView({block:'center',inline:'nearest'}));
  }
  // Keep focus and the selection in the point field while pressing keyboard buttons.
  panel.addEventListener('pointerdown',event=>event.preventDefault());
  panel.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!target)return;
    const action=button.dataset.action,start=target.selectionStart??target.value.length,end=target.selectionEnd??start;
    if(button.dataset.key){const key=button.dataset.key;return write(target.value.slice(0,start)+key+target.value.slice(end),start+1);}
    if(action==='letters'||action==='numbers'){mode=action;return render();}
    if(action==='clear')return write('',0);
    if(action==='backspace'){const from=start===end?Math.max(0,start-1):start;return write(target.value.slice(0,from)+target.value.slice(end),from);}
    if(action==='next'){
      const inputs=Array.from(document.querySelectorAll(selector)),next=inputs[inputs.indexOf(target)+1];
      if(!next)return close();next.focus({preventScroll:true});next.setSelectionRange(next.value.length,next.value.length);open(next);return;
    }
    close();
  });
  document.addEventListener('focusin',event=>{if(event.target.matches(selector))open(event.target);else if(!panel.contains(event.target)&&target)close();});
  document.addEventListener('click',event=>{if(event.target.matches(selector))open(event.target);});
  document.addEventListener('pointerdown',event=>{if(target&&!panel.contains(event.target)&&!event.target.matches(selector))close();},true);
  document.addEventListener('keydown',event=>{
    if(!target||document.activeElement!==target)return;
    if(event.key==='Escape'){event.preventDefault();return close();}
    if(event.key==='Backspace'||/^[a-z0-9]$/i.test(event.key)){
      event.preventDefault();panel.querySelector(event.key==='Backspace'?'[data-action="backspace"]':`[data-key="${event.key.toUpperCase()}"]`)?.click();
    }
  });
  new MutationObserver(()=>{if(target&&!target.isConnected)close();}).observe(document.getElementById('pointsBody'),{childList:true});
  window.addEventListener('resize',reserve);
  window.PointKeyboard={close,isOpen:()=>!panel.hidden};
});
