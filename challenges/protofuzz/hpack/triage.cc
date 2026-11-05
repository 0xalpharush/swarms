// one-shot three-way replay: read a hex HPACK block from argv[1], print
// nghttp2 and Rust verdicts+canonical output. Oracle (Go) run separately.
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <nghttp2/nghttp2.h>
extern "C" { void*rhpack_new(void); long rhpack_decode(void*,const uint8_t*,size_t,uint8_t*,size_t); }
static int c_decode(const uint8_t*in,size_t len,std::string&out){
  nghttp2_hd_inflater*inf; if(nghttp2_hd_inflate_new(&inf))return -1;
  int final=1,rc=0;
  for(;;){ nghttp2_nv nv; int fl=0;
    ssize_t rv=nghttp2_hd_inflate_hd2(inf,&nv,&fl,in,len,final);
    if(rv<0){rc=-1;break;} in+=rv; len-=rv;
    if(fl&NGHTTP2_HD_INFLATE_EMIT){uint32_t nl=nv.namelen,vl=nv.valuelen;
      out.append((char*)&nl,4);out.append((char*)nv.name,nv.namelen);
      out.append((char*)&vl,4);out.append((char*)nv.value,nv.valuelen);}
    if(fl&NGHTTP2_HD_INFLATE_FINAL){nghttp2_hd_inflate_end_headers(inf);break;}
    if(rv==0&&len==0)break; }
  nghttp2_hd_inflate_del(inf); return rc;
}
static std::string hx(const std::string&s){const char*h="0123456789abcdef";std::string o;for(unsigned char c:s){o+=h[c>>4];o+=h[c&15];}return o;}
int main(int argc,char**argv){
  if(argc<2)return 2; std::string hex=argv[1]; std::vector<uint8_t> b;
  for(size_t i=0;i+1<hex.size();i+=2)b.push_back((uint8_t)strtol(hex.substr(i,2).c_str(),0,16));
  std::string cout; int crv=c_decode(b.data(),b.size(),cout);
  std::vector<uint8_t> ob(1<<20); void*rd=rhpack_new();
  long rrv=rhpack_decode(rd,b.data(),b.size(),ob.data(),ob.size());
  std::string rout((char*)ob.data(),rrv<0?0:rrv);
  printf("C=%s:%s R=%s:%s\n",crv<0?"err":"ok",crv<0?"":hx(cout).c_str(),
         rrv<0?"err":"ok",rrv<0?"":hx(rout).c_str());
  return 0;
}
