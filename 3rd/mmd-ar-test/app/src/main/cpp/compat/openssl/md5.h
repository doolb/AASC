#pragma once
#include <boost/uuid/detail/md5.hpp>
#include <cstring>
// 词袋校验沿用上游MD5协议，用Boost实现，避免链接Android私有libcrypto。
constexpr int MD5_DIGEST_LENGTH = 16;
struct MD5_CTX { boost::uuids::detail::md5 value; };
inline int MD5_Init(MD5_CTX* context) { context->value = boost::uuids::detail::md5(); return 1; }
inline int MD5_Update(MD5_CTX* context, const void* data, size_t size) { context->value.process_bytes(data, size); return 1; }
inline int MD5_Final(unsigned char* result, MD5_CTX* context) {
    boost::uuids::detail::md5::digest_type digest;
    context->value.get_digest(digest);
    std::memcpy(result, digest, 16);
    return 1;
}
