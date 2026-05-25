(function(){
  var rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  // Scroll reveal
  var ro=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-visible');ro.unobserve(e.target)}})},{threshold:.1,rootMargin:'0px 0px -40px 0px'});
  document.querySelectorAll('.reveal').forEach(function(el){if(rm)el.classList.add('is-visible');else ro.observe(el)});
  // Score bar animation
  var bars=document.querySelectorAll('.hotel-card__score-bar');
  bars.forEach(function(b){var f=b.querySelector('.hotel-card__score-fill');if(!f)return;var w=f.style.width||'0%';f.dataset.w=w;if(!rm)f.style.width='0%'});
  if(!rm){var so=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var f=e.target.querySelector('.hotel-card__score-fill');if(f&&f.dataset.w)setTimeout(function(){f.style.width=f.dataset.w},200);so.unobserve(e.target)}})},{threshold:.4});
  bars.forEach(function(b){so.observe(b)})}
  // Sticky nav
  var nav=document.querySelector('.site-header');
  if(nav){var ly=window.scrollY,ti=false;window.addEventListener('scroll',function(){if(!ti){requestAnimationFrame(function(){var y=window.scrollY;if(y>300){if(y>ly+6)nav.style.transform='translateY(-100%)';else if(y<ly-6)nav.style.transform='translateY(0)'}else nav.style.transform='translateY(0)';ly=y;ti=false})};ti=true},{passive:true})}
  // Sticky CTA — show when main affiliate CTA scrolls out of view
  var sc=document.getElementById('sticky-cta');
  var mc=document.querySelector('.affiliate-cta');
  if(sc&&mc){var ob=new IntersectionObserver(function(es){es.forEach(function(e){sc.classList.toggle('is-visible',!e.isIntersecting);sc.setAttribute('aria-hidden',e.isIntersecting?'true':'false')})},{threshold:0.1});ob.observe(mc)}
})();
