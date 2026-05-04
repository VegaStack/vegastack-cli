# Resource: cloudflare_dns_record

Provides a Cloudflare DNS record. Replaces the legacy `cloudflare_record` (renamed in CF provider v5, Sep 2024).

## Example Usage

```terraform
resource "cloudflare_dns_record" "example" {
  zone_id = "023e105f4ecef8ad9ca31a8372d0c353"
  name    = "api"
  type    = "A"
  content = "203.0.113.42"
  ttl     = 1
  proxied = true
}
```

## Argument Reference

* `zone_id` - (Required)
* `name` - (Required)
* `type` - (Required) One of `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, `SRV`.
* `content` - (Required) Record content.
* `ttl` - (Optional)
* `proxied` - (Optional)

## Import

```sh
terraform import cloudflare_dns_record.example zone_id/record_id
```
